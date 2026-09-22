import type { GeneratedFile, LootItem, StudioProject } from '../core/types';

/** Solidity UTF-8 bytes, without interpolating user text into source syntax. */
function solidityString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `string(hex"${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}")`;
}

export function effectiveTokenId(item: LootItem, index: number): string {
  return BigInt(item.tokenId === undefined || item.tokenId === '' ? index : item.tokenId).toString();
}

const header = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
`;
const consumerImports = `import {D20VRFConsumer} from "@d20dao/vrf-sdk/contracts/D20VRFConsumer.sol";
import {ID20VRF} from "@d20dao/vrf-sdk/contracts/interfaces/ID20VRF.sol";
import {RandomnessMapping} from "@d20dao/vrf-sdk/contracts/libraries/RandomnessMapping.sol";
`;
const ownableImports = `import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStudioConsumerIdentity {
    function CONFIG_DIGEST() external view returns (bytes32);
    function collection() external view returns (address);
}
`;

function royaltySetup(project: StudioProject): string {
  return project.modules.royalty.enabled
    ? `        _setDefaultRoyalty(address(uint160(${BigInt(project.modules.royalty.recipient)})), ${project.modules.royalty.bps});`
    : '        // Royalties disabled: royaltyInfo returns zero.';
}

function controller(): string {
  return `    address public controller;
    error InvalidController();
    error OnlyController();
    event ControllerSet(address indexed controller);

    modifier onlyController() {
        if (msg.sender != controller) revert OnlyController();
        _;
    }

    /// @notice Wire the reviewed consumer once, after both contracts have been deployed.
    function setController(address controller_) external onlyOwner {
        if (controller != address(0) || controller_.code.length == 0) revert InvalidController();
        if (IStudioConsumerIdentity(controller_).CONFIG_DIGEST() != CONFIG_DIGEST ||
            IStudioConsumerIdentity(controller_).collection() != address(this)) revert InvalidController();
        controller = controller_;
        emit ControllerSet(controller_);
    }
`;
}

function lootCollection(project: StudioProject, fingerprint: string): string {
  const premint = project.modules.premint.enabled ? project.modules.premint.quantity : 0;
  const firstId = effectiveTokenId(project.loot.items[0], 0);
  return `${header}
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
${ownableImports}
/// @notice Fixed weighted reward item definitions; no public sale or arbitrary owner mint.
contract D20LootCollection is ERC1155, ERC2981, Ownable, ReentrancyGuard {
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    uint256 public constant MAX_SUPPLY = ${project.collection.maxSupply};
    uint256 public constant PREMINT_QUANTITY = ${premint};
    string public name;
    string public symbol;
    uint256 public mintedSupply;
    uint256 public reservedSupply;
    mapping(uint256 => bool) public knownItem;
    mapping(uint256 => string) private _itemUri;
    mapping(bytes32 => address) public reservedRecipient;
    mapping(bytes32 => bool) public completed;
    error SupplyUnavailable();
    error InvalidReservation();
    error UnknownItem();
${controller()}
    constructor(address initialOwner) ERC1155("") Ownable(initialOwner) {
        name = ${solidityString(project.collection.name)};
        symbol = ${solidityString(project.collection.symbol)};
${project.loot.items.map((item, index) => `        knownItem[${effectiveTokenId(item, index)}] = true;
        _itemUri[${effectiveTokenId(item, index)}] = ${solidityString(item.metadataUri)};`).join('\n')}
${royaltySetup(project)}
${premint > 0 ? `        mintedSupply = PREMINT_QUANTITY;
        _mint(address(uint160(${BigInt(project.modules.premint.recipient)})), ${firstId}, PREMINT_QUANTITY, "");` : ''}
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        if (!knownItem[tokenId]) revert UnknownItem();
        return _itemUri[tokenId];
    }

    function reserve(bytes32 actionKey, address recipient) external onlyController {
        if (recipient == address(0) || reservedRecipient[actionKey] != address(0) || completed[actionKey]) revert InvalidReservation();
        if (mintedSupply + reservedSupply >= MAX_SUPPLY) revert SupplyUnavailable();
        reservedRecipient[actionKey] = recipient;
        ++reservedSupply;
    }

    function release(bytes32 actionKey) external onlyController {
        if (reservedRecipient[actionKey] == address(0) || completed[actionKey]) revert InvalidReservation();
        delete reservedRecipient[actionKey];
        --reservedSupply;
    }

    function updateRecipient(bytes32 actionKey, address recipient) external onlyController {
        if (recipient == address(0) || reservedRecipient[actionKey] == address(0) || completed[actionKey]) revert InvalidReservation();
        reservedRecipient[actionKey] = recipient;
    }

    function deliver(bytes32 actionKey, uint256 tokenId) external onlyController nonReentrant {
        address recipient = reservedRecipient[actionKey];
        if (recipient == address(0) || completed[actionKey]) revert InvalidReservation();
        if (!knownItem[tokenId]) revert UnknownItem();
        delete reservedRecipient[actionKey];
        completed[actionKey] = true;
        --reservedSupply;
        ++mintedSupply;
        // All accounting is committed before the receiver hook; a rejecting receiver rolls it back.
        _mint(recipient, tokenId, 1, "");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
`;
}

function lootConsumer(project: StudioProject, fingerprint: string): string {
  const weights = project.loot.items.map(item => BigInt(item.weight));
  const total = weights.reduce((a, b) => a + b, 0n);
  return `${header}
${consumerImports}
interface ID20LootCollection {
    function CONFIG_DIGEST() external view returns (bytes32);
    function reserve(bytes32 actionKey, address recipient) external;
    function release(bytes32 actionKey) external;
    function updateRecipient(bytes32 actionKey, address recipient) external;
    function deliver(bytes32 actionKey, uint256 tokenId) external;
}

/// @notice RNG-fee-only reward opening. Application sale charges/sponsorship are not implemented.
contract D20LootStarter is D20VRFConsumer {
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    uint32 public constant CALLBACK_GAS = 100_000;
    uint256 public constant TOTAL_WEIGHT = ${total};
    uint256[${weights.length}] private _weights = [${weights.map(value => `uint256(${value})`).join(', ')}];
    uint256[${weights.length}] private _tokenIds = [${project.loot.items.map((item, index) => `uint256(${effectiveTokenId(item, index)})`).join(', ')}];
    ID20LootCollection public immutable collection;
    struct Opening { address requester; bytes32 actionKey; bytes32 word; bool ready; bool refunded; bool delivered; address deliveryRecipient; }
    mapping(uint256 => Opening) public openings;
    mapping(bytes32 => uint256) public requestForAction;
    error InvalidCollection();
    error InvalidAction();
    error InvalidRecipient();
    error OnlyRequester();
    error ActionAlreadyRequested();
    error Underpaid(uint256 required, uint256 sent);
    error UnexpectedCallback();
    error NotReady();
    error AlreadyDelivered();
    event OpeningRequested(bytes32 indexed actionKey, uint256 indexed requestId, address indexed requester);
    event OpeningReady(uint256 indexed requestId, bytes32 word);
    event OpeningRefunded(uint256 indexed requestId);
    event RewardDelivered(uint256 indexed requestId, uint256 indexed tokenId, address indexed recipient);
    event DeliveryRecipientChanged(uint256 indexed requestId, address indexed previousRecipient, address indexed recipient);

    constructor(address coordinator, address collection_) D20VRFConsumer(coordinator) {
        if (collection_.code.length == 0) revert InvalidCollection();
        if (ID20LootCollection(collection_).CONFIG_DIGEST() != CONFIG_DIGEST) revert InvalidCollection();
        collection = ID20LootCollection(collection_);
    }

    /// @dev One sender-scoped action, one reward; caller funds RNG and receives protocol refunds/credits.
    function open(bytes32 actionId) external payable returns (uint256 requestId) {
        return _open(actionId, msg.sender);
    }

    /// @notice Choose an NFT recipient independently of the requester and its protocol refund address.
    function openTo(bytes32 actionId, address recipient) external payable returns (uint256 requestId) {
        return _open(actionId, recipient);
    }

    function _open(bytes32 actionId, address recipient) internal returns (uint256 requestId) {
        if (actionId == bytes32(0)) revert InvalidAction();
        if (recipient == address(0)) revert InvalidRecipient();
        bytes32 actionKey = keccak256(abi.encode(msg.sender, actionId));
        uint256 previous = requestForAction[actionKey];
        if (previous != 0 && !openings[previous].refunded) revert ActionAlreadyRequested();
        uint256 fee = ID20VRF(vrfCoordinator).quoteFee(CALLBACK_GAS);
        if (msg.value < fee) revert Underpaid(fee, msg.value);
        collection.reserve(actionKey, recipient);
        RandomnessMapping.Spec memory spec = RandomnessMapping.Spec(RandomnessMapping.Operation.NumberRange, 1, TOTAL_WEIGHT, 1, 0);
        requestId = ID20VRF(vrfCoordinator).requestMappedRandomness{value: msg.value}(
            keccak256(abi.encode(CONFIG_DIGEST, actionKey)), CALLBACK_GAS, msg.sender, spec
        );
        openings[requestId] = Opening(msg.sender, actionKey, bytes32(0), false, false, false, recipient);
        requestForAction[actionKey] = requestId;
        emit OpeningRequested(actionKey, requestId, msg.sender);
    }

    function _fulfillRandomness(uint256 requestId, bytes32 word) internal override {
        Opening storage opening = openings[requestId];
        if (opening.requester == address(0) || opening.ready || opening.refunded ||
            requestForAction[opening.actionKey] != requestId) revert UnexpectedCallback();
        opening.word = word;
        opening.ready = true;
        emit OpeningReady(requestId, word);
    }

    function _onRefund(uint256 requestId) internal override {
        Opening storage opening = openings[requestId];
        if (opening.requester == address(0) || opening.ready) revert UnexpectedCallback();
        if (opening.refunded) return;
        opening.refunded = true;
        // Only this current attempt owns the reservation. Stale notifications cannot release a retry's slot.
        if (requestForAction[opening.actionKey] == requestId) collection.release(opening.actionKey);
        emit OpeningRefunded(requestId);
    }

    function rewardIndex(uint256 requestId) public view returns (uint256) {
        if (!openings[requestId].ready) revert NotReady();
        uint256 draw = ID20VRF(vrfCoordinator).getMappedResult(requestId)[0];
        uint256 cumulative;
        for (uint256 i; i < _weights.length; ++i) {
            cumulative += _weights[i];
            if (draw <= cumulative) return i;
        }
        revert NotReady();
    }

    function rewardTokenId(uint256 requestId) public view returns (uint256) { return _tokenIds[rewardIndex(requestId)]; }

    /// @notice Recover delivery to an unsupported NFT receiver without changing the accepted outcome.
    /// @dev Only the original requester can redirect its outstanding accepted entitlement.
    function setDeliveryRecipient(uint256 requestId, address recipient) external {
        Opening storage opening = openings[requestId];
        if (msg.sender != opening.requester) revert OnlyRequester();
        if (!opening.ready || opening.refunded) revert NotReady();
        if (opening.delivered) revert AlreadyDelivered();
        if (recipient == address(0)) revert InvalidRecipient();
        address previousRecipient = opening.deliveryRecipient;
        opening.deliveryRecipient = recipient;
        collection.updateRecipient(opening.actionKey, recipient);
        emit DeliveryRecipientChanged(requestId, previousRecipient, recipient);
    }

    /// @notice Anyone may complete the recorded outcome; the recipient and token ID cannot be chosen by the caller.
    function deliver(uint256 requestId) external {
        Opening storage opening = openings[requestId];
        if (!opening.ready) revert NotReady();
        if (opening.delivered) revert AlreadyDelivered();
        uint256 tokenId = rewardTokenId(requestId);
        address recipient = opening.deliveryRecipient;
        opening.delivered = true;
        collection.deliver(opening.actionKey, tokenId);
        emit RewardDelivered(requestId, tokenId, recipient);
    }
}
`;
}

function revealCollection(project: StudioProject, fingerprint: string): string {
  const premint = project.modules.premint.enabled ? project.modules.premint.quantity : 0;
  const offset = project.modules.premint.enabled && !project.modules.premint.includeInReveal ? premint : 0;
  return `${header}
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
${ownableImports}
/// @notice Owner-distributed fixed-supply ERC721, with one bounded reveal and immutable URI rules.
contract D20RevealCollection is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    uint256 public constant MAX_SUPPLY = ${project.collection.maxSupply};
    uint256 public constant PREMINT_QUANTITY = ${premint};
    uint256 public constant REVEAL_OFFSET = ${offset};
    uint32 public constant POPULATION = ${project.collection.maxSupply - offset};
    uint256 public mintedSupply;
    bool public mintClosed;
    bool public revealLocked;
    bool public revealed;
    string public metadataBaseUri;
    mapping(uint256 => uint256) public metadataIndex;
    error InvalidMint();
    error MintNotClosed();
    error AlreadyRevealed();
    error InvalidAssignment();
    event MintClosed();
    event CollectionRevealed();
${controller()}
    constructor(address initialOwner) ERC721(${solidityString(project.collection.name)}, ${solidityString(project.collection.symbol)}) Ownable(initialOwner) {
        metadataBaseUri = ${solidityString(project.collection.metadataBaseUri)};
${royaltySetup(project)}
${premint > 0 ? `        for (uint256 id; id < PREMINT_QUANTITY; ++id) {
            ++mintedSupply;
            _safeMint(address(uint160(${BigInt(project.modules.premint.recipient)})), id);
        }` : ''}
    }

    /// @notice Distribution hook, not a public paid mint. Owner sends tokens to recipients in bounded batches.
    function mint(address recipient, uint256 quantity) external onlyOwner nonReentrant {
        if (mintClosed || quantity == 0 || quantity > 64 || mintedSupply + quantity > MAX_SUPPLY) revert InvalidMint();
        for (uint256 i; i < quantity; ++i) {
            uint256 id = mintedSupply++;
            _safeMint(recipient, id);
        }
    }

    function closeMint() external onlyOwner {
        if (mintClosed || mintedSupply != MAX_SUPPLY) revert InvalidMint();
        mintClosed = true;
        emit MintClosed();
    }

    function lockReveal() external onlyController {
        if (!mintClosed) revert MintNotClosed();
        if (revealed) revert AlreadyRevealed();
        revealLocked = true;
    }

    function reveal(uint256[] calldata assignment) external onlyController {
        if (!revealLocked) revert MintNotClosed();
        if (revealed) revert AlreadyRevealed();
        if (assignment.length != POPULATION) revert InvalidAssignment();
        bool[] memory seen = new bool[](POPULATION);
        for (uint256 i; i < POPULATION; ++i) {
            uint256 index = assignment[i];
            if (index >= POPULATION || seen[index]) revert InvalidAssignment();
            seen[index] = true;
            metadataIndex[REVEAL_OFFSET + i] = REVEAL_OFFSET + index;
        }
        revealed = true;
        emit CollectionRevealed();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (tokenId < REVEAL_OFFSET) return string.concat(metadataBaseUri, tokenId.toString(), ".json");
        if (!revealed) return "";
        return string.concat(metadataBaseUri, metadataIndex[tokenId].toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
`;
}

function revealConsumer(project: StudioProject, fingerprint: string): string {
  const offset = project.modules.premint.enabled && !project.modules.premint.includeInReveal ? project.modules.premint.quantity : 0;
  return `${header}
${consumerImports}
interface ID20RevealCollection {
    function CONFIG_DIGEST() external view returns (bytes32);
    function lockReveal() external;
    function reveal(uint256[] calldata assignment) external;
}

contract D20RevealStarter is D20VRFConsumer {
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    uint32 public constant CALLBACK_GAS = 100_000;
    uint32 public constant POPULATION = ${project.collection.maxSupply - offset};
    address public immutable operator;
    ID20RevealCollection public immutable collection;
    uint256 public requestId;
    bytes32 public word;
    bool public ready;
    bool public finalized;
    error InvalidOperator();
    error InvalidCollection();
    error OnlyOperator();
    error AlreadyRequested();
    error Underpaid(uint256 required, uint256 sent);
    error UnexpectedCallback();
    error NotReady();
    error AlreadyFinalized();
    event RevealRequested(uint256 indexed requestId);
    event RevealReady(uint256 indexed requestId, bytes32 word);
    event RevealAttemptRefunded(uint256 indexed requestId);
    event RevealFinalized(uint256 indexed requestId);

    constructor(address coordinator, address collection_, address operator_) D20VRFConsumer(coordinator) {
        if (operator_ == address(0)) revert InvalidOperator();
        if (collection_.code.length == 0) revert InvalidCollection();
        if (ID20RevealCollection(collection_).CONFIG_DIGEST() != CONFIG_DIGEST) revert InvalidCollection();
        operator = operator_;
        collection = ID20RevealCollection(collection_);
    }

    function requestReveal() external payable returns (uint256 id) {
        if (msg.sender != operator) revert OnlyOperator();
        if (requestId != 0 || ready) revert AlreadyRequested();
        uint256 fee = ID20VRF(vrfCoordinator).quoteFee(CALLBACK_GAS);
        if (msg.value < fee) revert Underpaid(fee, msg.value);
        collection.lockReveal();
        RandomnessMapping.Spec memory spec = RandomnessMapping.Spec(RandomnessMapping.Operation.Shuffle, 0, 0, POPULATION, POPULATION);
        id = ID20VRF(vrfCoordinator).requestMappedRandomness{value: msg.value}(CONFIG_DIGEST, CALLBACK_GAS, msg.sender, spec);
        requestId = id;
        emit RevealRequested(id);
    }

    function _fulfillRandomness(uint256 id, bytes32 randomness) internal override {
        if (id == 0 || id != requestId || ready) revert UnexpectedCallback();
        word = randomness;
        ready = true;
        emit RevealReady(id, randomness);
    }

    function _onRefund(uint256 id) internal override {
        if (id == 0 || id != requestId || ready) revert UnexpectedCallback();
        requestId = 0;
        emit RevealAttemptRefunded(id);
    }

    function assignment() public view returns (uint256[] memory) {
        if (!ready) revert NotReady();
        return ID20VRF(vrfCoordinator).getMappedResult(requestId);
    }

    /// @notice Permissionless application delivery; applies exactly the accepted permutation once.
    function finalizeReveal() external {
        if (!ready) revert NotReady();
        if (finalized) revert AlreadyFinalized();
        finalized = true;
        collection.reveal(assignment());
        emit RevealFinalized(requestId);
    }
}
`;
}

export function nftFiles(project: StudioProject, fingerprint: string): GeneratedFile[] {
  return project.mechanic === 'lootbox'
    ? [
      { path: 'contracts/D20LootCollection.sol', language: 'solidity', content: lootCollection(project, fingerprint) },
      { path: 'contracts/D20LootStarter.sol', language: 'solidity', content: lootConsumer(project, fingerprint) },
    ]
    : [
      { path: 'contracts/D20RevealCollection.sol', language: 'solidity', content: revealCollection(project, fingerprint) },
      { path: 'contracts/D20RevealStarter.sol', language: 'solidity', content: revealConsumer(project, fingerprint) },
    ];
}
