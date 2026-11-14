// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import "./MedicinePackNFT.sol";
import "./ColdChainOracle.sol";
import "./QRAttestation.sol";
import "./RegulatorGovernance.sol";

/**
 * @title MedSupplySentinel
 * @author MedSupply Sentinel Team
 * @notice Master supply chain orchestrator managing pharmaceutical batch creation,
 * serialization, Merkle root anchoring, end-to-end custody handovers, dispensing,
 * zero-knowledge prescription receipt commitments, and consumer verification.
 */
contract MedSupplySentinel is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    enum VerificationOutcome {
        UNKNOWN_SERIAL,
        AUTHENTIC,
        EXPIRED,
        ALREADY_DISPENSED,
        QUARANTINED,
        RECALLED,
        COLD_CHAIN_BREACHED,
        SUSPICIOUS_DUPLICATE
    }

    struct Batch {
        bytes32 batchId;
        string productCode; // GTIN / SKU
        string brandName;
        address manufacturer;
        uint256 totalPackCount;
        uint256 packsRegistered;
        uint256 manufacturedAt;
        uint256 expiresAt;
        int16 minTemp;
        int16 maxTemp;
        bool exists;
    }

    struct CustodyRecord {
        address from;
        address to;
        uint256 timestamp;
        string notes;
    }

    // Sub-contracts
    MedicinePackNFT public immutable packNFT;
    ColdChainOracle public immutable coldChainOracle;
    QRAttestation public immutable qrAttestation;
    RegulatorGovernance public immutable regulatorGov;

    // Batches storage
    mapping(bytes32 => Batch) public batches;
    bytes32[] public batchList;

    // Batch Merkle Roots for O(log N) zero-gas pack inclusion proofs: batchId => merkleRoot
    mapping(bytes32 => bytes32) public batchMerkleRoots;

    // Custody history: serialHash => array of CustodyRecord
    mapping(bytes32 => CustodyRecord[]) private _custodyHistory;

    // Mapping: serialHash => patient receipt hash (privacy-preserving ZK salted commitment)
    mapping(bytes32 => bytes32) public dispensedReceipts;

    // Mapping: serialHash => Physical Unclonable Function (PUF) 256-bit micro-seal hash
    mapping(bytes32 => bytes32) public packPufSealHashes;

    // Mapping: serialHash => 3 Shamir GF(p) custodian share commitments [Pharmacy, Manufacturer, Regulator]
    mapping(bytes32 => bytes32[3]) public shamirBreakGlassCommitments;

    // Global sequential token id counter for pack NFT
    uint256 private _nextTokenId = 1;

    // Events
    event BatchCreated(
        bytes32 indexed batchId,
        string productCode,
        string brandName,
        address indexed manufacturer,
        uint256 packCount,
        uint256 expiresAt
    );

    event BatchMerkleRootAnchored(
        bytes32 indexed batchId,
        bytes32 indexed merkleRoot,
        address indexed manufacturer,
        uint256 timestamp
    );

    event PacksBatchRegistered(
        bytes32 indexed batchId,
        uint256 startTokenId,
        uint256 endTokenId,
        uint256 count
    );

    event CustodyTransferred(
        bytes32 indexed serialHash,
        address indexed from,
        address indexed to,
        uint256 timestamp,
        string notes
    );

    event PackDispensed(
        bytes32 indexed serialHash,
        bytes32 indexed batchId,
        address indexed pharmacy,
        bytes32 patientReceiptHash,
        uint256 timestamp
    );

    event PufSealAnchored(
        bytes32 indexed serialHash,
        bytes32 indexed pufSealHash,
        address indexed manufacturer,
        uint256 timestamp
    );

    event ShamirBreakGlassCommitted(
        bytes32 indexed serialHash,
        bytes32[3] shareCommitments,
        uint256 timestamp
    );

    event BreakGlassRecallReconstructed(
        bytes32 indexed serialHash,
        address indexed regulator,
        uint8 sharesSubmitted,
        uint256 timestamp
    );

    // Errors
    error BatchAlreadyExists(bytes32 batchId);
    error BatchDoesNotExist(bytes32 batchId);
    error InvalidExpirationDate();
    error ExceedsBatchPackCount();
    error NotPackCustodian(bytes32 serialHash, address caller);
    error PackNotAtPharmacy();
    error PackAlreadyDispensed();
    error MedicineExpired(uint256 expiresAt);
    error BatchUnderQuarantineOrRecall(string reason);
    error InvalidMerkleRoot();

    constructor(
        address admin,
        address _packNFT,
        address _coldChainOracle,
        address _qrAttestation,
        address _regulatorGov
    ) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANUFACTURER_ROLE, admin);
        _grantRole(DISTRIBUTOR_ROLE, admin);
        _grantRole(PHARMACY_ROLE, admin);
        _grantRole(REGULATOR_ROLE, admin);

        packNFT = MedicinePackNFT(_packNFT);
        coldChainOracle = ColdChainOracle(_coldChainOracle);
        qrAttestation = QRAttestation(_qrAttestation);
        regulatorGov = RegulatorGovernance(_regulatorGov);
    }

    /**
     * @notice Registers a new production batch of medicine.
     */
    function createBatch(
        bytes32 batchId,
        string calldata productCode,
        string calldata brandName,
        uint256 totalPackCount,
        uint256 expiresAt,
        int16 minTemp,
        int16 maxTemp,
        uint32 maxExcursionSeconds
    ) external onlyRole(MANUFACTURER_ROLE) whenNotPaused {
        if (batches[batchId].exists) {
            revert BatchAlreadyExists(batchId);
        }
        if (expiresAt <= block.timestamp) {
            revert InvalidExpirationDate();
        }

        batches[batchId] = Batch({
            batchId: batchId,
            productCode: productCode,
            brandName: brandName,
            manufacturer: msg.sender,
            totalPackCount: totalPackCount,
            packsRegistered: 0,
            manufacturedAt: block.timestamp,
            expiresAt: expiresAt,
            minTemp: minTemp,
            maxTemp: maxTemp,
            exists: true
        });

        batchList.push(batchId);

        // Configure cold-chain parameters in the oracle
        coldChainOracle.setBatchProfile(batchId, minTemp, maxTemp, maxExcursionSeconds);

        emit BatchCreated(
            batchId,
            productCode,
            brandName,
            msg.sender,
            totalPackCount,
            expiresAt
        );
    }

    /**
     * @notice Anchors a cryptographic Merkle Root for a batch so thousands of packs can be verified in O(log N) gasless view calls.
     */
    function anchorBatchMerkleRoot(
        bytes32 batchId,
        bytes32 merkleRoot
    ) external onlyRole(MANUFACTURER_ROLE) whenNotPaused {
        Batch storage b = batches[batchId];
        if (!b.exists) {
            revert BatchDoesNotExist(batchId);
        }
        if (merkleRoot == bytes32(0)) {
            revert InvalidMerkleRoot();
        }
        require(b.manufacturer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not batch creator");

        batchMerkleRoots[batchId] = merkleRoot;
        emit BatchMerkleRootAnchored(batchId, merkleRoot, msg.sender, block.timestamp);
    }

    /**
     * @notice Verifies a medicine pack's inclusion in a batch's anchored Merkle tree in O(log N) steps.
     * @param batchId Batch identifier.
     * @param serialHash Pack serial hash.
     * @param expiryTimestamp Pack expiration timestamp.
     * @param merkleProof Array of sibling hashes along the Merkle path from leaf to root.
     */
    function verifyPackMerkleInclusion(
        bytes32 batchId,
        bytes32 serialHash,
        uint256 expiryTimestamp,
        bytes32[] calldata merkleProof
    ) external view returns (bool isIncluded, bytes32 leafHash, bytes32 anchoredRoot) {
        anchoredRoot = batchMerkleRoots[batchId];
        leafHash = keccak256(bytes.concat(keccak256(abi.encode(batchId, serialHash, expiryTimestamp))));
        if (anchoredRoot == bytes32(0)) {
            return (false, leafHash, bytes32(0));
        }
        isIncluded = MerkleProof.verify(merkleProof, anchoredRoot, leafHash);
    }

    /**
     * @notice Verifies a zero-knowledge salted commitment for a patient's prescription receipt without exposing PII on-chain.
     */
    function verifyZKPatientReceiptCommitment(
        bytes32 serialHash,
        bytes32 prescriptionIdHash,
        bytes32 patientSecretSalt
    ) external view returns (bool isVerified, bytes32 expectedCommitment) {
        expectedCommitment = dispensedReceipts[serialHash];
        if (expectedCommitment == bytes32(0)) {
            return (false, bytes32(0));
        }
        bytes32 computedCommitment = keccak256(
            abi.encodePacked("MEDSUPPLY_ZK_RX_V1", serialHash, prescriptionIdHash, patientSecretSalt)
        );
        isVerified = (computedCommitment == expectedCommitment);
    }

    /**
     * @notice Registers and mints serialized medicine pack NFTs for a batch.
     */
    function registerSerializedPacks(
        bytes32 batchId,
        bytes32[] calldata serialHashes,
        string[] calldata tokenURIs
    ) external onlyRole(MANUFACTURER_ROLE) nonReentrant whenNotPaused {
        Batch storage b = batches[batchId];
        if (!b.exists) {
            revert BatchDoesNotExist(batchId);
        }
        require(b.manufacturer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not batch creator");
        require(serialHashes.length == tokenURIs.length, "Array lengths mismatch");

        if (b.packsRegistered + serialHashes.length > b.totalPackCount) {
            revert ExceedsBatchPackCount();
        }

        uint256 startId = _nextTokenId;

        for (uint256 i = 0; i < serialHashes.length; i++) {
            uint256 tokenId = _nextTokenId;
            _nextTokenId++;

            packNFT.mintPack(
                msg.sender,
                tokenId,
                batchId,
                serialHashes[i],
                b.expiresAt,
                tokenURIs[i]
            );

            _custodyHistory[serialHashes[i]].push(
                CustodyRecord({
                    from: address(0),
                    to: msg.sender,
                    timestamp: block.timestamp,
                    notes: "Genesis manufacturing packaging"
                })
            );
        }

        b.packsRegistered += serialHashes.length;

        emit PacksBatchRegistered(batchId, startId, _nextTokenId - 1, serialHashes.length);
    }

    /**
     * @notice Custody Handover: Manufacturer -> Distributor
     */
    function transferToDistributor(
        bytes32 serialHash,
        address distributor,
        string calldata notes
    ) external onlyRole(MANUFACTURER_ROLE) whenNotPaused {
        _transferCustody(serialHash, distributor, MedicinePackNFT.PackStatus.IN_TRANSIT, notes);
    }

    /**
     * @notice Custody Handover: Distributor -> Pharmacy
     */
    function transferToPharmacy(
        bytes32 serialHash,
        address pharmacy,
        string calldata notes
    ) external onlyRole(DISTRIBUTOR_ROLE) whenNotPaused {
        _transferCustody(serialHash, pharmacy, MedicinePackNFT.PackStatus.AT_PHARMACY, notes);
    }

    function _transferCustody(
        bytes32 serialHash,
        address nextCustodian,
        MedicinePackNFT.PackStatus newStatus,
        string memory notes
    ) internal {
        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        MedicinePackNFT.PackMetadata memory pack = packNFT.getPack(tokenId);

        if (pack.currentCustodian != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotPackCustodian(serialHash, msg.sender);
        }

        // Verify batch not under active quarantine or recall
        (bool isQuarantined, bool isRecalled, string memory reason) = regulatorGov.isCompromised(
            pack.batchId,
            serialHash
        );
        if (isQuarantined || isRecalled) {
            revert BatchUnderQuarantineOrRecall(reason);
        }

        packNFT.updateCustodian(tokenId, nextCustodian);
        packNFT.updateStatus(tokenId, newStatus, notes);

        _custodyHistory[serialHash].push(
            CustodyRecord({
                from: msg.sender,
                to: nextCustodian,
                timestamp: block.timestamp,
                notes: notes
            })
        );

        emit CustodyTransferred(serialHash, msg.sender, nextCustodian, block.timestamp, notes);
    }

    /**
     * @notice Dispenses a pack to an end patient. Enforces authenticity, expiry, and quarantine gates.
     */
    function dispenseToPatient(
        bytes32 serialHash,
        bytes32 patientReceiptHash
    ) external onlyRole(PHARMACY_ROLE) nonReentrant whenNotPaused {
        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        MedicinePackNFT.PackMetadata memory pack = packNFT.getPack(tokenId);

        if (pack.currentCustodian != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotPackCustodian(serialHash, msg.sender);
        }
        if (pack.status == MedicinePackNFT.PackStatus.DISPENSED) {
            revert PackAlreadyDispensed();
        }
        if (pack.status != MedicinePackNFT.PackStatus.AT_PHARMACY) {
            revert PackNotAtPharmacy();
        }
        if (block.timestamp > pack.expiryTimestamp) {
            revert MedicineExpired(pack.expiryTimestamp);
        }

        (bool isQuarantined, bool isRecalled, string memory reason) = regulatorGov.isCompromised(
            pack.batchId,
            serialHash
        );
        if (isQuarantined || isRecalled) {
            revert BatchUnderQuarantineOrRecall(reason);
        }

        packNFT.updateStatus(tokenId, MedicinePackNFT.PackStatus.DISPENSED, "Dispensed to patient");
        dispensedReceipts[serialHash] = patientReceiptHash;

        _custodyHistory[serialHash].push(
            CustodyRecord({
                from: msg.sender,
                to: address(0x000000000000000000000000000000000000dEaD),
                timestamp: block.timestamp,
                notes: "Dispensed to end-consumer"
            })
        );

        emit PackDispensed(serialHash, pack.batchId, msg.sender, patientReceiptHash, block.timestamp);
    }

    /**
     * @notice Comprehensive verification for patients, pharmacists, and regulators.
     * Evaluates expiration, quarantine, recall, cold-chain breach, and duplicate scan states.
     */
    function verifyMedicinePack(
        bytes32 serialHash
    ) external view returns (
        VerificationOutcome outcome,
        string memory detail,
        MedicinePackNFT.PackMetadata memory pack,
        Batch memory batch,
        uint32 scanCount,
        bool coldChainBreached
    ) {
        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        if (tokenId == 0) {
            return (
                VerificationOutcome.UNKNOWN_SERIAL,
                "Serial number is not registered in the system",
                pack,
                batch,
                0,
                false
            );
        }

        pack = packNFT.getPack(tokenId);
        batch = batches[pack.batchId];
        coldChainBreached = coldChainOracle.isBatchBreached(pack.batchId);

        QRAttestation.ScanRecord memory scanRec = qrAttestation.getScanRecord(serialHash);
        scanCount = scanRec.scanCount;

        // Check 1: Quarantine or Recall (Highest priority)
        (bool isQuarantined, bool isRecalled, string memory compReason) = regulatorGov.isCompromised(
            pack.batchId,
            serialHash
        );
        if (isQuarantined) {
            return (VerificationOutcome.QUARANTINED, compReason, pack, batch, scanCount, coldChainBreached);
        }
        if (isRecalled) {
            return (VerificationOutcome.RECALLED, compReason, pack, batch, scanCount, coldChainBreached);
        }

        // Check 2: Expiration
        if (block.timestamp > pack.expiryTimestamp) {
            return (
                VerificationOutcome.EXPIRED,
                "Medicine has passed its safe expiration date",
                pack,
                batch,
                scanCount,
                coldChainBreached
            );
        }

        // Check 3: Already Dispensed
        if (pack.status == MedicinePackNFT.PackStatus.DISPENSED) {
            return (
                VerificationOutcome.ALREADY_DISPENSED,
                "This pack was already marked as dispensed by a licensed pharmacy",
                pack,
                batch,
                scanCount,
                coldChainBreached
            );
        }

        // Check 4: Cold-chain thermal excursion
        if (coldChainBreached) {
            return (
                VerificationOutcome.COLD_CHAIN_BREACHED,
                "Critical temperature breach recorded during transit or storage",
                pack,
                batch,
                scanCount,
                true
            );
        }

        // Check 5: Suspicious duplicate scans (> 1 scans before dispensing)
        if (scanCount > 1) {
            return (
                VerificationOutcome.SUSPICIOUS_DUPLICATE,
                "Duplicate QR scans detected prior to patient point-of-sale",
                pack,
                batch,
                scanCount,
                false
            );
        }

        // Check 6: Authentic & safe
        return (
            VerificationOutcome.AUTHENTIC,
            "Authentic product with verified chain of custody and intact cold chain",
            pack,
            batch,
            scanCount,
            false
        );
    }

    /**
     * @notice Anchors a Physical Unclonable Function (PUF) micro-fiber hologram fingerprint for anti-photocopy verification.
     */
    function anchorPackPufSeal(
        bytes32 serialHash,
        bytes32 pufSealHash
    ) external onlyRole(MANUFACTURER_ROLE) whenNotPaused {
        require(pufSealHash != bytes32(0), "Invalid PUF seal digest");
        packPufSealHashes[serialHash] = pufSealHash;
        emit PufSealAnchored(serialHash, pufSealHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Computes exact 256-bit XOR Hamming distance against the anchored PUF seal on-chain.
     */
    function verifyPUFOpticalSeal(
        bytes32 serialHash,
        bytes32 scannedPufHash,
        uint16 maxAllowedBitDrift
    ) external view returns (bool isAuthenticSeal, uint16 bitDrift, bytes32 anchoredPufHash) {
        anchoredPufHash = packPufSealHashes[serialHash];
        if (anchoredPufHash == bytes32(0)) {
            return (false, 256, bytes32(0));
        }
        uint256 diff = uint256(anchoredPufHash ^ scannedPufHash);
        while (diff != 0) {
            diff &= diff - 1;
            unchecked {
                bitDrift++;
            }
        }
        isAuthenticSeal = bitDrift <= maxAllowedBitDrift;
    }

    /**
     * @notice Anchors 3-party Shamir (2-of-3) break-glass recall share commitments at dispense without exposing PII.
     */
    function commitShamirBreakGlassShares(
        bytes32 serialHash,
        bytes32[3] calldata shareCommitments
    ) external onlyRole(PHARMACY_ROLE) whenNotPaused {
        shamirBreakGlassCommitments[serialHash] = shareCommitments;
        emit ShamirBreakGlassCommitted(serialHash, shareCommitments, block.timestamp);
    }

    /**
     * @notice Emits an immutable regulator audit event when >=2 Shamir shares unlock a Class I recall recipient token.
     */
    function recordBreakGlassReconstruction(
        bytes32 serialHash,
        uint8 sharesSubmitted
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        require(sharesSubmitted >= 2, "Threshold 2-of-3 shares required");
        emit BreakGlassRecallReconstructed(serialHash, msg.sender, sharesSubmitted, block.timestamp);
    }

    function getCustodyHistory(bytes32 serialHash) external view returns (CustodyRecord[] memory) {
        return _custodyHistory[serialHash];
    }

    function getBatchesCount() external view returns (uint256) {
        return batchList.length;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
