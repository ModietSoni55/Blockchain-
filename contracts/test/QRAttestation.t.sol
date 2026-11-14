// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/QRAttestation.sol";

contract QRAttestationTest is Test {
    QRAttestation public attestation;

    address public admin = address(0xAA1);
    uint256 public issuerPrivateKey = 0xA11CE;
    address public issuer;
    address public scannerUser = address(0x222);

    bytes32 public serialHash = keccak256("SN-VERIFY-0099");
    bytes32 public batchId = keccak256("BATCH-QR-TEST");

    function setUp() public {
        issuer = vm.addr(issuerPrivateKey);

        vm.startPrank(admin);
        attestation = new QRAttestation(admin);
        attestation.grantRole(attestation.ISSUER_ROLE(), issuer);
        vm.stopPrank();
    }

    function test_VerifyAuthenticQRAndDetectDuplicate() public {
        uint256 expiry = block.timestamp + 180 days;
        bytes32 nonce = keccak256("NONCE-UNIQUE-1");
        uint256 issuedAt = block.timestamp;

        bytes32 payloadHash = keccak256(
            abi.encodePacked(
                serialHash,
                batchId,
                expiry,
                nonce,
                issuedAt,
                block.chainid
            )
        );

        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(payloadHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerPrivateKey, ethSigned);
        bytes memory sig = abi.encodePacked(r, s, v);

        // First scan by patient: should be authentic and NOT duplicate
        vm.prank(scannerUser);
        (bool isValid, bool isDuplicate, uint32 scanCount) = attestation.verifyAndRecordScan(
            serialHash,
            batchId,
            expiry,
            nonce,
            issuedAt,
            sig
        );

        assertTrue(isValid);
        assertFalse(isDuplicate);
        assertEq(scanCount, 1);

        // Second scan of the same physical serial: should flag as DUPLICATE!
        vm.prank(scannerUser);
        (isValid, isDuplicate, scanCount) = attestation.verifyAndRecordScan(
            serialHash,
            batchId,
            expiry,
            nonce,
            issuedAt,
            sig
        );

        assertTrue(isValid);
        assertTrue(isDuplicate); // Duplicate clone/replay flag activated!
        assertEq(scanCount, 2);

        QRAttestation.ScanRecord memory record = attestation.getScanRecord(serialHash);
        assertTrue(record.isFlaggedSuspicious);
    }

    function test_RevertWhenQRIsExpired() public {
        uint256 expiry = block.timestamp - 1 seconds; // Expired
        bytes32 nonce = keccak256("NONCE-UNIQUE-2");
        uint256 issuedAt = block.timestamp - 100 days;

        bytes32 payloadHash = keccak256(
            abi.encodePacked(
                serialHash,
                batchId,
                expiry,
                nonce,
                issuedAt,
                block.chainid
            )
        );

        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(payloadHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerPrivateKey, ethSigned);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(scannerUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                QRAttestation.AttestationExpired.selector,
                expiry,
                block.timestamp
            )
        );
        attestation.verifyAndRecordScan(
            serialHash,
            batchId,
            expiry,
            nonce,
            issuedAt,
            sig
        );
    }

    function test_VerifyEIP712TypedAttestation() public {
        uint256 expiry = block.timestamp + 180 days;
        bytes32 nonce = keccak256("EIP712-NONCE-1");
        uint256 issuedAt = block.timestamp;

        bytes32 structHash = keccak256(
            abi.encode(
                attestation.PACK_ATTESTATION_TYPEHASH(),
                serialHash,
                batchId,
                expiry,
                nonce,
                issuedAt
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(attestation.domainSeparatorV4(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        (bool isValid, address recoveredSigner, bytes32 returnedDigest) = attestation.verifyEIP712Attestation(
            serialHash,
            batchId,
            expiry,
            nonce,
            issuedAt,
            sig
        );

        assertTrue(isValid);
        assertEq(recoveredSigner, issuer);
        assertEq(returnedDigest, digest);
    }
}
