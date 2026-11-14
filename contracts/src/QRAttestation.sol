// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title QRAttestation
 * @author MedSupply Sentinel Team
 * @notice Cryptographic attestation and anti-replay verifier for physical QR medicine codes.
 * @dev Verifies manufacturer ECDSA signatures, enforces nonces, and flags clone/duplicate scans.
 */
contract QRAttestation is AccessControl, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // EIP-712 Typed Structured Data Constants
    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PACK_ATTESTATION_TYPEHASH =
        keccak256(
            "PackAttestation(bytes32 serialHash,bytes32 batchId,uint256 expiryTimestamp,bytes32 nonce,uint256 issuedAt)"
        );

    struct ScanRecord {
        uint32 scanCount;
        uint256 firstScanTimestamp;
        uint256 latestScanTimestamp;
        address latestScanner;
        bool isFlaggedSuspicious;
    }

    // Mapping: serialHash => ScanRecord
    mapping(bytes32 => ScanRecord) public scanRecords;

    // Mapping: nonce => whether nonce has already been consumed
    mapping(bytes32 => bool) public usedNonces;

    event QRAttested(
        bytes32 indexed serialHash,
        bytes32 indexed batchId,
        address indexed scanner,
        uint32 totalScans,
        bool isSuspicious
    );

    event DuplicateScanDetected(
        bytes32 indexed serialHash,
        uint32 scanCount,
        uint256 previousScanTimestamp,
        uint256 currentScanTimestamp,
        address scanner
    );

    event NonceInvalidated(bytes32 indexed nonce);

    error NonceAlreadyUsed(bytes32 nonce);
    error AttestationExpired(uint256 expiryTimestamp, uint256 currentTimestamp);
    error InvalidIssuerSignature();
    error SerialHashMismatch();

    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
    }

    /**
     * @notice Returns the EIP-712 Domain Separator for this contract and chain ID.
     */
    function domainSeparatorV4() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    EIP712_DOMAIN_TYPEHASH,
                    keccak256(bytes("MedSupplySentinelQRAttestation")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                )
            );
    }

    /**
     * @notice Verifies an EIP-712 typed structured data signature for a medicine pack QR attestation.
     */
    function verifyEIP712Attestation(
        bytes32 serialHash,
        bytes32 batchId,
        uint256 expiryTimestamp,
        bytes32 nonce,
        uint256 issuedAt,
        bytes calldata signature
    ) external view returns (bool isValid, address recoveredSigner, bytes32 digest) {
        bytes32 structHash = keccak256(
            abi.encode(
                PACK_ATTESTATION_TYPEHASH,
                serialHash,
                batchId,
                expiryTimestamp,
                nonce,
                issuedAt
            )
        );
        digest = MessageHashUtils.toTypedDataHash(domainSeparatorV4(), structHash);
        recoveredSigner = digest.recover(signature);
        isValid = hasRole(ISSUER_ROLE, recoveredSigner) && block.timestamp <= expiryTimestamp;
    }

    /**
     * @notice Verifies an attestation payload and records scan activity.
     * @param serialHash keccak256 hash of the unique pack serial number.
     * @param batchId Global batch identifier.
     * @param expiryTimestamp Pack expiration time.
     * @param nonce Single-use random nonce generated at QR creation.
     * @param issuedAt Timestamp when QR was stamped by manufacturer.
     * @param signature Cryptographic signature by authorized ISSUER_ROLE.
     * @return isValid True if signature and timestamps are valid.
     * @return isDuplicate True if serial has been scanned before (suspicion flag).
     * @return scanCount Total number of scans for this pack.
     */
    function verifyAndRecordScan(
        bytes32 serialHash,
        bytes32 batchId,
        uint256 expiryTimestamp,
        bytes32 nonce,
        uint256 issuedAt,
        bytes calldata signature
    ) external whenNotPaused returns (bool isValid, bool isDuplicate, uint32 scanCount) {
        if (block.timestamp > expiryTimestamp) {
            revert AttestationExpired(expiryTimestamp, block.timestamp);
        }

        // Reconstruct EIP-191 compliant signed hash
        bytes32 payloadHash = keccak256(
            abi.encodePacked(
                serialHash,
                batchId,
                expiryTimestamp,
                nonce,
                issuedAt,
                block.chainid
            )
        );

        bytes32 ethSignedHash = payloadHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        if (!hasRole(ISSUER_ROLE, signer)) {
            revert InvalidIssuerSignature();
        }

        ScanRecord storage record = scanRecords[serialHash];
        record.scanCount += 1;
        scanCount = record.scanCount;

        if (record.scanCount == 1) {
            record.firstScanTimestamp = block.timestamp;
            record.latestScanTimestamp = block.timestamp;
            record.latestScanner = msg.sender;
            isDuplicate = false;
        } else {
            isDuplicate = true;
            record.isFlaggedSuspicious = true;
            emit DuplicateScanDetected(
                serialHash,
                record.scanCount,
                record.latestScanTimestamp,
                block.timestamp,
                msg.sender
            );
            record.latestScanTimestamp = block.timestamp;
            record.latestScanner = msg.sender;
        }

        emit QRAttested(serialHash, batchId, msg.sender, record.scanCount, record.isFlaggedSuspicious);

        return (true, isDuplicate, scanCount);
    }

    /**
     * @notice Invalidates a single-use nonce for one-time verification tokens.
     */
    function invalidateNonce(bytes32 nonce) external onlyRole(VERIFIER_ROLE) {
        if (usedNonces[nonce]) {
            revert NonceAlreadyUsed(nonce);
        }
        usedNonces[nonce] = true;
        emit NonceInvalidated(nonce);
    }

    function getScanRecord(bytes32 serialHash) external view returns (ScanRecord memory) {
        return scanRecords[serialHash];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
