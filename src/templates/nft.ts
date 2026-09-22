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
    bool public constant SUPPLY_CAPPED = ${project.collection.maxSupply !== null};
    uint256 public constant MAX_SUPPLY = ${project.collection.maxSupply ?? 0};
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
        if (SUPPLY_CAPPED && mintedSupply + reservedSupply >= MAX_SUPPLY) revert SupplyUnavailable();
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
  const mode = project.reveal.mode;
  const shuffle = mode === 'shuffle';
  const countType = shuffle ? 'uint32' : 'uint256';
  const completed = `        nextRevealToken = start + count;
        pendingRevealStart = 0;
        pendingRevealCount = 0;
        emit CollectionBatchRevealed(start, count);`;
  const checkRange = '        if (count == 0 || start != pendingRevealStart || count != pendingRevealCount) revert InvalidAssignment();';
  const batchLookup = `    function _batchFor(uint256 tokenId) private view returns (FinalizedBatch storage batch) {
        uint256 low;
        uint256 high = finalizedBatches.length;
        while (low < high) {
            uint256 middle = low + (high - low) / 2;
            if (tokenId < finalizedBatches[middle].end) high = middle;
            else low = middle + 1;
        }
        if (low == finalizedBatches.length || tokenId < finalizedBatches[low].start) revert NotRevealed();
        return finalizedBatches[low];
    }
`;
  const assignmentCode = shuffle
    ? `    function revealBatch(uint256 start, uint32 count, uint256[] calldata assignment) external onlyController nonReentrant {
${checkRange}
        if (assignment.length != count) revert InvalidAssignment();
        bool[] memory seen = new bool[](count);
        for (uint256 i; i < count; ++i) {
            uint256 index = assignment[i];
            if (index >= count || seen[index]) revert InvalidAssignment();
            seen[index] = true;
            _metadataIndex[start + i] = start + index;
        }
${completed}
    }

    function metadataIndex(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        if (tokenId < REVEAL_OFFSET) return tokenId;
        if (tokenId >= nextRevealToken) revert NotRevealed();
        return _metadataIndex[tokenId];
    }
`
    : mode === 'offset'
      ? `    function revealBatch(uint256 start, uint256 count, uint256 offset) external onlyController nonReentrant {
${checkRange}
        if (offset >= count) revert InvalidAssignment();
        finalizedBatches.push(FinalizedBatch(start, start + count, offset));
${completed}
    }

    function metadataIndex(uint256 tokenId) public view returns (uint256) {
        _requireOwned(tokenId);
        if (tokenId < REVEAL_OFFSET) return tokenId;
        if (tokenId >= nextRevealToken) revert NotRevealed();
        FinalizedBatch storage batch = _batchFor(tokenId);
        return batch.start + addmod(tokenId - batch.start, batch.offset, batch.end - batch.start);
    }

${batchLookup}`
      : `    function revealBatch(uint256 start, uint256 count, bytes32 word) external onlyController nonReentrant {
${checkRange}
        finalizedBatches.push(FinalizedBatch(start, start + count, word));
${completed}
    }

    /// @notice Public deterministic trait seed, not a unique metadata permutation or hidden randomness.
    function tokenHash(uint256 tokenId) public view returns (bytes32) {
        _requireOwned(tokenId);
        if (tokenId < REVEAL_OFFSET) revert NotParticipating();
        if (tokenId >= nextRevealToken) revert NotRevealed();
        FinalizedBatch storage batch = _batchFor(tokenId);
        return keccak256(abi.encode(TOKEN_HASH_DOMAIN, block.chainid, address(this), CONFIG_DIGEST, batch.word, tokenId));
    }

${batchLookup}`;
  return `${header}
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
${ownableImports}
/// @notice Owner-distributed ERC721 with optional supply cap and frozen ${mode} reveal batches.
contract D20RevealCollection is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    bool public constant SUPPLY_CAPPED = ${project.collection.maxSupply !== null};
    uint256 public constant MAX_SUPPLY = ${project.collection.maxSupply ?? 0};
    uint256 public constant PREMINT_QUANTITY = ${premint};
    address public constant PREMINT_RECIPIENT = address(uint160(${premint > 0 ? BigInt(project.modules.premint.recipient) : 0n}));
    uint256 public constant REVEAL_OFFSET = ${offset};
${shuffle ? '    uint32 public constant MAX_REVEAL_BATCH = 256;' : ''}
${mode === 'token-hash' ? '    bytes32 public constant TOKEN_HASH_DOMAIN = keccak256("D20DAO_STUDIO_TOKEN_HASH_V1");' : ''}
    uint256 public mintedSupply;
    uint256 public premintMinted;
    bool public mintClosed;
    uint256 public nextRevealToken = REVEAL_OFFSET;
    uint256 public pendingRevealStart;
    ${countType} public pendingRevealCount;
    string public metadataBaseUri;
${shuffle ? '    mapping(uint256 => uint256) private _metadataIndex;' : `    struct FinalizedBatch { uint256 start; uint256 end; ${mode === 'offset' ? 'uint256 offset' : 'bytes32 word'}; }
    FinalizedBatch[] public finalizedBatches;`}
    error NotRevealed();
${mode === 'token-hash' ? '    error NotParticipating();' : ''}
    error InvalidMint();
    error PremintIncomplete();
    error NothingToReveal();
    error InvalidAssignment();
    event MintClosed(uint256 mintedSupply);
    event RevealBatchLocked(uint256 indexed start, ${countType} count);
    event CollectionBatchRevealed(uint256 indexed start, ${countType} count);
${controller()}
    constructor(address initialOwner) ERC721(${solidityString(project.collection.name)}, ${solidityString(project.collection.symbol)}) Ownable(initialOwner) {
        metadataBaseUri = ${solidityString(project.collection.metadataBaseUri)};
${royaltySetup(project)}
    }

    /// @notice Stage the fixed premint allocation in caller-sized transactions; no constructor mint loop.
    function mintPremint(uint256 quantity) external onlyOwner nonReentrant {
        if (mintClosed || quantity == 0 || quantity > PREMINT_QUANTITY - premintMinted) revert InvalidMint();
        _checkSupply(quantity);
        premintMinted += quantity;
        _mintSequential(PREMINT_RECIPIENT, quantity);
    }

    /// @notice Distribution hook, not a paid sale. Quantity is limited by supply and transaction gas, not a product batch cap.
    function mint(address recipient, uint256 quantity) external onlyOwner nonReentrant {
        if (premintMinted != PREMINT_QUANTITY) revert PremintIncomplete();
        if (mintClosed || recipient == address(0) || quantity == 0) revert InvalidMint();
        _checkSupply(quantity);
        _mintSequential(recipient, quantity);
    }

    function _checkSupply(uint256 quantity) private view {
        if (SUPPLY_CAPPED && quantity > MAX_SUPPLY - mintedSupply) revert InvalidMint();
    }

    function _mintSequential(address recipient, uint256 quantity) private {
        for (uint256 i; i < quantity; ++i) {
            uint256 id = mintedSupply++;
            _safeMint(recipient, id);
        }
    }

    function closeMint() external onlyOwner nonReentrant {
        if (premintMinted != PREMINT_QUANTITY) revert PremintIncomplete();
        if (mintClosed) revert InvalidMint();
        mintClosed = true;
        emit MintClosed(mintedSupply);
    }

    /// @notice Freeze the next already-minted range. A refunded request retries this exact range even if more tokens mint.
    function lockRevealBatch() external onlyController nonReentrant returns (uint256 start, ${countType} count) {
        if (premintMinted != PREMINT_QUANTITY) revert PremintIncomplete();
        if (pendingRevealCount != 0) return (pendingRevealStart, pendingRevealCount);
        uint256 available = mintedSupply - nextRevealToken;
        if (available == 0) revert NothingToReveal();
        start = nextRevealToken;
        count = ${shuffle ? 'uint32(available > MAX_REVEAL_BATCH ? MAX_REVEAL_BATCH : available)' : 'available'};
        pendingRevealStart = start;
        pendingRevealCount = count;
        emit RevealBatchLocked(start, count);
    }

${assignmentCode}

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (tokenId < REVEAL_OFFSET) return string.concat(metadataBaseUri, tokenId.toString(), ".json");
        if (tokenId >= nextRevealToken) return "";
        return string.concat(metadataBaseUri, ${mode === 'token-hash' ? 'tokenId' : 'metadataIndex(tokenId)'}.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
`;
}

function revealConsumer(project: StudioProject, fingerprint: string): string {
  const mode = project.reveal.mode;
  const shuffle = mode === 'shuffle';
  const countType = shuffle ? 'uint32' : 'uint256';
  const resultArgument = shuffle ? 'uint256[] calldata assignment' : mode === 'offset' ? 'uint256 offset' : 'bytes32 word';
  const requestCode = mode === 'token-hash'
    ? `        id = ID20VRF(vrfCoordinator).requestRandomness{value: msg.value}(
            keccak256(abi.encode(CONFIG_DIGEST, start, count)), CALLBACK_GAS, msg.sender
        );`
    : `        RandomnessMapping.Spec memory spec = ${shuffle
      ? 'RandomnessMapping.Spec(RandomnessMapping.Operation.Shuffle, 0, 0, count, count)'
      : 'RandomnessMapping.Spec(RandomnessMapping.Operation.NumberRange, 0, count - 1, 1, 0)'};
        id = ID20VRF(vrfCoordinator).requestMappedRandomness{value: msg.value}(
            keccak256(abi.encode(CONFIG_DIGEST, start, count)), CALLBACK_GAS, msg.sender, spec
        );`;
  const resultCode = shuffle
    ? `    function assignment(uint256 id) public view returns (uint256[] memory) {
        if (!reveals[id].ready || reveals[id].refunded) revert NotReady();
        return ID20VRF(vrfCoordinator).getMappedResult(id);
    }`
    : mode === 'offset'
      ? `    function offset(uint256 id) public view returns (uint256) {
        if (!reveals[id].ready || reveals[id].refunded) revert NotReady();
        return ID20VRF(vrfCoordinator).getMappedResult(id)[0];
    }`
      : `    function resultWord(uint256 id) public view returns (bytes32) {
        if (!reveals[id].ready || reveals[id].refunded) revert NotReady();
        return reveals[id].word;
    }`;
  return `${header}
${mode === 'token-hash' ? consumerImports.replace('import {RandomnessMapping} from "@d20dao/vrf-sdk/contracts/libraries/RandomnessMapping.sol";\n', '') : consumerImports}
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
interface ID20RevealCollection {
    function CONFIG_DIGEST() external view returns (bytes32);
    function lockRevealBatch() external returns (uint256 start, ${countType} count);
    function revealBatch(uint256 start, ${countType} count, ${resultArgument}) external;
}

contract D20RevealStarter is D20VRFConsumer, ReentrancyGuard {
    bytes32 public constant CONFIG_DIGEST = 0x${fingerprint};
    uint32 public constant CALLBACK_GAS = 100_000;
    address public immutable operator;
    ID20RevealCollection public immutable collection;
    struct RevealRequest { uint256 start; ${countType} count; bytes32 word; bool ready; bool refunded; bool finalized; }
    mapping(uint256 => RevealRequest) public reveals;
    uint256 public currentRequestId;
    error InvalidOperator();
    error InvalidCollection();
    error OnlyOperator();
    error AlreadyRequested();
    error Underpaid(uint256 required, uint256 sent);
    error UnexpectedCallback();
    error NotReady();
    error AlreadyFinalized();
    event RevealRequested(uint256 indexed requestId, uint256 indexed start, ${countType} count);
    event RevealReady(uint256 indexed requestId, bytes32 word);
    event RevealAttemptRefunded(uint256 indexed requestId, uint256 indexed start, ${countType} count);
    event RevealFinalized(uint256 indexed requestId, uint256 indexed start, ${countType} count);

    constructor(address coordinator, address collection_, address operator_) D20VRFConsumer(coordinator) {
        if (operator_ == address(0)) revert InvalidOperator();
        if (collection_.code.length == 0) revert InvalidCollection();
        if (ID20RevealCollection(collection_).CONFIG_DIGEST() != CONFIG_DIGEST) revert InvalidCollection();
        operator = operator_;
        collection = ID20RevealCollection(collection_);
    }

    function requestReveal() external payable nonReentrant returns (uint256 id) {
        if (msg.sender != operator) revert OnlyOperator();
        if (currentRequestId != 0) revert AlreadyRequested();
        uint256 fee = ID20VRF(vrfCoordinator).quoteFee(CALLBACK_GAS);
        if (msg.value < fee) revert Underpaid(fee, msg.value);
        (uint256 start, ${countType} count) = collection.lockRevealBatch();
${requestCode}
        reveals[id] = RevealRequest(start, count, bytes32(0), false, false, false);
        currentRequestId = id;
        emit RevealRequested(id, start, count);
    }

    function _fulfillRandomness(uint256 id, bytes32 randomness) internal override {
        RevealRequest storage reveal = reveals[id];
        if (id == 0 || id != currentRequestId || reveal.count == 0 || reveal.ready || reveal.refunded || reveal.finalized) revert UnexpectedCallback();
        reveal.word = randomness;
        reveal.ready = true;
        emit RevealReady(id, randomness);
    }

    function _onRefund(uint256 id) internal override {
        RevealRequest storage reveal = reveals[id];
        if (id == 0 || reveal.count == 0 || reveal.ready || reveal.finalized) revert UnexpectedCallback();
        if (reveal.refunded) return;
        if (id != currentRequestId) revert UnexpectedCallback();
        reveal.refunded = true;
        currentRequestId = 0;
        emit RevealAttemptRefunded(id, reveal.start, reveal.count);
    }

${resultCode}

    /// @notice Permissionless application delivery; applies exactly the accepted batch result once.
    function finalizeReveal(uint256 id) external nonReentrant {
        RevealRequest storage reveal = reveals[id];
        if (!reveal.ready || reveal.refunded) revert NotReady();
        if (reveal.finalized) revert AlreadyFinalized();
        if (id != currentRequestId) revert NotReady();
        reveal.finalized = true;
        collection.revealBatch(reveal.start, reveal.count, ${shuffle ? 'assignment(id)' : mode === 'offset' ? 'offset(id)' : 'reveal.word'});
        currentRequestId = 0;
        emit RevealFinalized(id, reveal.start, reveal.count);
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
