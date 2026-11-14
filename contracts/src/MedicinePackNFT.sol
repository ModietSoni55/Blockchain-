// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MedicinePackNFT
 * @author MedSupply Sentinel Team
 * @notice ERC-721 digital passport representing an individual serialized medicine pack.
 * @dev Transfers are restricted to authorized supply-chain controllers to prevent
 * unauthorized secondary market trading while maintaining a tamper-evident audit trail.
 */
contract MedicinePackNFT is ERC721URIStorage, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    enum PackStatus {
        MANUFACTURED,
        IN_TRANSIT,
        AT_PHARMACY,
        DISPENSED,
        QUARANTINED,
        RECALLED
    }

    struct PackMetadata {
        bytes32 batchId;
        bytes32 serialHash;
        uint256 mintTimestamp;
        uint256 expiryTimestamp;
        address currentCustodian;
        PackStatus status;
        bool exists;
    }

    // Mapping from tokenId to PackMetadata
    mapping(uint256 => PackMetadata) private _packData;

    // Mapping from serialHash to tokenId
    mapping(bytes32 => uint256) public serialToTokenId;

    // ERC-5192 Minimal Soulbound Token lock mapping (tokenId => locked)
    mapping(uint256 => bool) private _soulboundLocked;

    /// @notice ERC-5192 event emitted when a medicine pack passport becomes permanently soulbound (e.g., DISPENSED)
    event Locked(uint256 tokenId);

    event PackMinted(
        uint256 indexed tokenId,
        bytes32 indexed batchId,
        bytes32 indexed serialHash,
        address custodian,
        uint256 expiryTimestamp
    );

    event PackStatusChanged(
        uint256 indexed tokenId,
        PackStatus previousStatus,
        PackStatus newStatus,
        string reason
    );

    event CustodianTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to
    );

    error PackAlreadyExists(bytes32 serialHash);
    error PackDoesNotExist(uint256 tokenId);
    error UnauthorizedTransfer();
    error InvalidTimestamp();
    error PackAlreadyDispensed();
    error PackSoulboundLocked(uint256 tokenId);

    constructor(address admin) ERC721("MedSupply Sentinel Passport", "MEDPACK") {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(CONTROLLER_ROLE, admin);
    }

    /**
     * @notice Mints a new medicine pack digital passport.
     * @param to The recipient address (initial custodian, typically manufacturer).
     * @param tokenId Unique sequential integer identifier.
     * @param batchId Global identifier of the parent manufacturing batch.
     * @param serialHash Cryptographic hash (keccak256) of the unique pack serial number.
     * @param expiryTimestamp Unix epoch timestamp after which the medicine expires.
     * @param tokenURI Metadata URI pointing to verifiable pack specs.
     */
    function mintPack(
        address to,
        uint256 tokenId,
        bytes32 batchId,
        bytes32 serialHash,
        uint256 expiryTimestamp,
        string calldata tokenURI
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        if (serialToTokenId[serialHash] != 0 || _packData[tokenId].exists) {
            revert PackAlreadyExists(serialHash);
        }
        if (expiryTimestamp <= block.timestamp) {
            revert InvalidTimestamp();
        }

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);

        _packData[tokenId] = PackMetadata({
            batchId: batchId,
            serialHash: serialHash,
            mintTimestamp: block.timestamp,
            expiryTimestamp: expiryTimestamp,
            currentCustodian: to,
            status: PackStatus.MANUFACTURED,
            exists: true
        });

        serialToTokenId[serialHash] = tokenId;

        emit PackMinted(tokenId, batchId, serialHash, to, expiryTimestamp);
    }

    /**
     * @notice Updates the lifecycle status of a pack. Automatically engages ERC-5192 Soulbound lock when DISPENSED or RECALLED.
     * @param tokenId Unique token identifier.
     * @param newStatus New status to transition to.
     * @param reason Human-readable justification for the change.
     */
    function updateStatus(
        uint256 tokenId,
        PackStatus newStatus,
        string calldata reason
    ) external onlyRole(CONTROLLER_ROLE) whenNotPaused {
        if (!_packData[tokenId].exists) {
            revert PackDoesNotExist(tokenId);
        }

        PackStatus previousStatus = _packData[tokenId].status;
        _packData[tokenId].status = newStatus;

        if (
            (newStatus == PackStatus.DISPENSED || newStatus == PackStatus.RECALLED) &&
            !_soulboundLocked[tokenId]
        ) {
            _soulboundLocked[tokenId] = true;
            emit Locked(tokenId);
        }

        emit PackStatusChanged(tokenId, previousStatus, newStatus, reason);
    }

    /**
     * @notice ERC-5192 view function returning whether a pack passport is permanently soulbound-locked.
     */
    function locked(uint256 tokenId) external view returns (bool) {
        if (!_packData[tokenId].exists) {
            revert PackDoesNotExist(tokenId);
        }
        return _soulboundLocked[tokenId];
    }

    /**
     * @notice Updates the registered custodian following authorized supply chain handover.
     * @param tokenId Unique token identifier.
     * @param newCustodian Next participant in the custody chain.
     */
    function updateCustodian(
        uint256 tokenId,
        address newCustodian
    ) external onlyRole(CONTROLLER_ROLE) whenNotPaused {
        if (!_packData[tokenId].exists) {
            revert PackDoesNotExist(tokenId);
        }
        if (_soulboundLocked[tokenId]) {
            revert PackSoulboundLocked(tokenId);
        }
        require(newCustodian != address(0), "Invalid custodian");

        address previousCustodian = _packData[tokenId].currentCustodian;
        _packData[tokenId].currentCustodian = newCustodian;

        // Perform internal ERC721 transfer to mirror digital ownership
        _transfer(previousCustodian, newCustodian, tokenId);

        emit CustodianTransferred(tokenId, previousCustodian, newCustodian);
    }

    /**
     * @notice Returns comprehensive metadata for an individual pack.
     * @param tokenId Token identifier.
     */
    function getPack(uint256 tokenId) external view returns (PackMetadata memory) {
        if (!_packData[tokenId].exists) {
            revert PackDoesNotExist(tokenId);
        }
        return _packData[tokenId];
    }

    /**
     * @notice Prevents unauthorized transfers outside the controlled supply chain protocol and enforces ERC-5192 Soulbound lock.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override whenNotPaused returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == 0) and burning (to == 0)
        if (from != address(0) && to != address(0)) {
            if (_soulboundLocked[tokenId]) {
                revert PackSoulboundLocked(tokenId);
            }
            // Transfers must be initiated by an authorized CONTROLLER_ROLE or DEFAULT_ADMIN_ROLE
            if (!hasRole(CONTROLLER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
                revert UnauthorizedTransfer();
            }
        }
        return super._update(to, tokenId, auth);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
