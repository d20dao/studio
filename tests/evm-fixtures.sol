// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RandomnessMapping} from "@d20dao/vrf-sdk/contracts/libraries/RandomnessMapping.sol";
import {ID20VRFConsumer, ID20VRFRefundConsumer} from "@d20dao/vrf-sdk/contracts/interfaces/ID20VRF.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @dev Local lifecycle double. It does NOT implement or claim VRF cryptographic verification.
///      Production coordinator behavior is separately implemented by the pinned D20DAO protocol.
contract LifecycleCoordinator {
    uint256 public constant FEE = 1000;
    struct Request {
        address consumer; address recipient; uint64 deadline; uint32 gasLimit;
        bytes32 word; bool accepted; bool delivered; bool refunded; bool notified;
    }
    mapping(uint256 => Request) public requests;
    mapping(uint256 => RandomnessMapping.Spec) private _specs;
    mapping(address => uint256) public refundCredit;
    uint256 public nextId = 1;
    uint256 public lastCallbackGas;
    bool public lastCallbackSucceeded;
    bool public delayNotification;
    bool private _entered;
    modifier nonReentrant() { require(!_entered, "reentry"); _entered = true; _; _entered = false; }

    function quoteFee(uint32) external pure returns (uint256) { return FEE; }
    function setDelayNotification(bool delay) external { delayNotification = delay; }

    function requestMappedRandomness(bytes32, uint32 gasLimit, address recipient, RandomnessMapping.Spec calldata spec)
        external payable nonReentrant returns (uint256 id)
    {
        require(msg.value >= FEE && recipient != address(0), "fee");
        RandomnessMapping.validate(spec);
        id = nextId++;
        requests[id] = Request(msg.sender, recipient, uint64(block.timestamp + 60), gasLimit, bytes32(0), false, false, false, false);
        _specs[id] = spec;
        refundCredit[recipient] += msg.value - FEE;
    }

    function getMappedResult(uint256 id) external view returns (uint256[] memory) {
        require(requests[id].accepted, "not accepted");
        return RandomnessMapping.map(requests[id].word, _specs[id]);
    }

    function fulfill(uint256 id, bytes32 word, uint32 firstAttemptGas) external nonReentrant {
        Request storage r = requests[id];
        require(r.consumer != address(0) && !r.accepted && !r.refunded && block.timestamp <= r.deadline, "cannot accept");
        r.accepted = true;
        r.word = word;
        _deliver(id, firstAttemptGas == 0 ? r.gasLimit : firstAttemptGas);
    }

    function retryCallback(uint256 id, uint32 gasLimit) external nonReentrant {
        Request storage r = requests[id];
        require(r.accepted && !r.delivered && gasLimit >= r.gasLimit, "cannot retry");
        _deliver(id, gasLimit);
    }

    function _deliver(uint256 id, uint32 gasLimit) private {
        Request storage r = requests[id];
        uint256 beforeGas = gasleft();
        (bool ok,) = r.consumer.call{gas: gasLimit}(abi.encodeCall(ID20VRFConsumer.rawFulfillRandomness, (id, r.word)));
        lastCallbackGas = beforeGas - gasleft();
        lastCallbackSucceeded = ok;
        r.delivered = ok;
    }

    function refundRequest(uint256 id) external nonReentrant {
        Request storage r = requests[id];
        require(r.consumer != address(0) && !r.accepted && !r.refunded && block.timestamp > r.deadline, "cannot refund");
        r.refunded = true;
        (bool paid,) = r.recipient.call{value: FEE}("");
        if (!paid) refundCredit[r.recipient] += FEE;
        if (!delayNotification) _notify(id, 100_000);
    }

    function retryRefundCallback(uint256 id, uint32 gasLimit) external nonReentrant {
        require(requests[id].refunded && !requests[id].notified, "cannot notify");
        _notify(id, gasLimit);
    }

    function _notify(uint256 id, uint32 gasLimit) private {
        Request storage r = requests[id];
        uint256 beforeGas = gasleft();
        (bool ok,) = r.consumer.call{gas: gasLimit}(abi.encodeCall(ID20VRFRefundConsumer.onRefund, (id)));
        lastCallbackGas = beforeGas - gasleft();
        lastCallbackSucceeded = ok;
        r.notified = ok;
    }

    // Explicit adversarial test hooks, not production coordinator API.
    function rawCallbackForTest(address consumer, uint256 id, bytes32 word) external {
        (lastCallbackSucceeded,) = consumer.call{gas: 100_000}(abi.encodeCall(ID20VRFConsumer.rawFulfillRandomness, (id, word)));
    }
    function rawRefundForTest(address consumer, uint256 id) external {
        (lastCallbackSucceeded,) = consumer.call{gas: 100_000}(abi.encodeCall(ID20VRFRefundConsumer.onRefund, (id)));
    }
}

interface IOpeningForTest {
    function open(bytes32 actionId) external payable returns (uint256);
    function openTo(bytes32 actionId, address recipient) external payable returns (uint256);
    function setDeliveryRecipient(uint256 requestId, address recipient) external;
    function deliver(uint256 requestId) external;
}

contract RewardReceiver is ERC1155Holder {
    bool public rejectTokens;
    bool public rejectNative;
    function setRejectTokens(bool value) external { rejectTokens = value; }
    function setRejectNative(bool value) external { rejectNative = value; }
    function open(address consumer, bytes32 actionId) external payable returns (uint256) {
        return IOpeningForTest(consumer).open{value: msg.value}(actionId);
    }
    function onERC1155Received(address, address, uint256, uint256, bytes memory) public view override returns (bytes4) {
        require(!rejectTokens, "receiver rejects NFT");
        return this.onERC1155Received.selector;
    }
    receive() external payable { require(!rejectNative, "receiver rejects native"); }
}

/// @dev Can request or redirect its own entitlement, but can never receive an ERC1155 safe mint.
contract PermanentRejectingRequester {
    address public immutable owner = msg.sender;
    modifier onlyOwner() { require(msg.sender == owner, "only owner"); _; }
    function open(address consumer, bytes32 actionId) external payable onlyOwner returns (uint256) {
        return IOpeningForTest(consumer).open{value: msg.value}(actionId);
    }
    function openTo(address consumer, bytes32 actionId, address recipient) external payable onlyOwner returns (uint256) {
        return IOpeningForTest(consumer).openTo{value: msg.value}(actionId, recipient);
    }
    function redirect(address consumer, uint256 requestId, address recipient) external onlyOwner {
        IOpeningForTest(consumer).setDeliveryRecipient(requestId, recipient);
    }
    receive() external payable {}
}

contract ReentrantRewardReceiver is ERC1155Holder {
    address private _consumer;
    address private _replacement;
    uint256 private _requestId;
    bool public redirectSucceeded;
    bool public duplicateDeliverySucceeded;
    function open(address consumer, bytes32 actionId, address replacement) external payable returns (uint256) {
        _consumer = consumer;
        _replacement = replacement;
        _requestId = IOpeningForTest(consumer).open{value: msg.value}(actionId);
        return _requestId;
    }
    function onERC1155Received(address, address, uint256, uint256, bytes memory) public override returns (bytes4) {
        try IOpeningForTest(_consumer).setDeliveryRecipient(_requestId, _replacement) { redirectSucceeded = true; } catch {}
        try IOpeningForTest(_consumer).deliver(_requestId) { duplicateDeliverySucceeded = true; } catch {}
        return this.onERC1155Received.selector;
    }
}

contract DeploymentFactory {
    function deploy(bytes memory creationCode) external returns (address deployed) {
        assembly ("memory-safe") { deployed := create(0, add(creationCode, 0x20), mload(creationCode)) }
        require(deployed != address(0), "creation failed");
    }
}
