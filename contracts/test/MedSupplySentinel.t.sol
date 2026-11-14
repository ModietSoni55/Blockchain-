// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/MedicinePackNFT.sol";
import "../src/ColdChainOracle.sol";
import "../src/QRAttestation.sol";
import "../src/RegulatorGovernance.sol";
import "../src/MedSupplySentinel.sol";

contract MedSupplySentinelTest is Test {
    MedSupplySentinel public sentinel;
    MedicinePackNFT public packNFT;
    ColdChainOracle public oracle;
    QRAttestation public qrAttestation;
    RegulatorGovernance public regulatorGov;

    address public admin = address(0xAA1);
    address public manufacturer = address(0xBB2);
    address public distributor = address(0xCC3);
    address public pharmacy = address(0xDD4);
    address public regulator = address(0xEE5);
    address public patient = address(0xFF6);
    address public unauthorized = address(0x999);

    bytes32 public batchId = keccak256("BATCH-VAC-2026-001");
    bytes32 public serialHash = keccak256("SN-VAC-0042");

    function setUp() public {
        vm.startPrank(admin);

        packNFT = new MedicinePackNFT(admin);
        oracle = new ColdChainOracle(admin);
        qrAttestation = new QRAttestation(admin);
        regulatorGov = new RegulatorGovernance(admin);

        sentinel = new MedSupplySentinel(
            admin,
            address(packNFT),
            address(oracle),
            address(qrAttestation),
            address(regulatorGov)
        );

        // Grant roles to sentinel
        packNFT.grantRole(packNFT.MINTER_ROLE(), address(sentinel));
        packNFT.grantRole(packNFT.CONTROLLER_ROLE(), address(sentinel));
        oracle.grantRole(oracle.ORACLE_ROLE(), address(sentinel));

        // Grant participant roles
        sentinel.grantRole(sentinel.MANUFACTURER_ROLE(), manufacturer);
        sentinel.grantRole(sentinel.DISTRIBUTOR_ROLE(), distributor);
        sentinel.grantRole(sentinel.PHARMACY_ROLE(), pharmacy);
        sentinel.grantRole(sentinel.REGULATOR_ROLE(), regulator);

        regulatorGov.grantRole(regulatorGov.REGULATOR_ROLE(), regulator);
        oracle.grantRole(oracle.REPORTER_ROLE(), admin);

        vm.stopPrank();
    }

    function test_CreateBatchAndRegisterPacks() public {
        vm.startPrank(manufacturer);

        uint256 expiresAt = block.timestamp + 365 days;
        sentinel.createBatch(
            batchId,
            "GTIN-09384210",
            "PneumoGuard 13",
            100,
            expiresAt,
            200, // 2.00°C
            800, // 8.00°C
            3600
        );

        bytes32[] memory serials = new bytes32[](1);
        serials[0] = serialHash;

        string[] memory uris = new string[](1);
        uris[0] = "ipfs://QmSampleHashMetadata";

        sentinel.registerSerializedPacks(batchId, serials, uris);

        vm.stopPrank();

        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        assertEq(tokenId, 1);

        MedicinePackNFT.PackMetadata memory pack = packNFT.getPack(tokenId);
        assertEq(pack.currentCustodian, manufacturer);
        assertEq(uint256(pack.status), uint256(MedicinePackNFT.PackStatus.MANUFACTURED));
    }

    function test_FullCustodyHandoverAndDispense() public {
        _createDefaultBatchAndPack();

        // Step 1: Manufacturer transfers to Distributor
        vm.prank(manufacturer);
        sentinel.transferToDistributor(serialHash, distributor, "Dispatched via Reefer Truck #402");

        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        MedicinePackNFT.PackMetadata memory packAfterDist = packNFT.getPack(tokenId);
        assertEq(packAfterDist.currentCustodian, distributor);
        assertEq(uint256(packAfterDist.status), uint256(MedicinePackNFT.PackStatus.IN_TRANSIT));

        // Step 2: Distributor transfers to Pharmacy
        vm.prank(distributor);
        sentinel.transferToPharmacy(serialHash, pharmacy, "Received at City Hospital Central Pharmacy");

        MedicinePackNFT.PackMetadata memory packAfterPharm = packNFT.getPack(tokenId);
        assertEq(packAfterPharm.currentCustodian, pharmacy);
        assertEq(uint256(packAfterPharm.status), uint256(MedicinePackNFT.PackStatus.AT_PHARMACY));

        // Step 3: Pharmacy dispenses to Patient
        bytes32 receiptHash = keccak256("RX-PATIENT-99812");
        vm.prank(pharmacy);
        sentinel.dispenseToPatient(serialHash, receiptHash);

        MedicinePackNFT.PackMetadata memory packAfterDispense = packNFT.getPack(tokenId);
        assertEq(uint256(packAfterDispense.status), uint256(MedicinePackNFT.PackStatus.DISPENSED));
        assertEq(sentinel.dispensedReceipts(serialHash), receiptHash);

        // Verification outcome should reflect ALREADY_DISPENSED
        (MedSupplySentinel.VerificationOutcome outcome, , , , , ) = sentinel.verifyMedicinePack(serialHash);
        assertEq(uint256(outcome), uint256(MedSupplySentinel.VerificationOutcome.ALREADY_DISPENSED));
    }

    function test_RevertWhenUnauthorizedTriesToTransfer() public {
        _createDefaultBatchAndPack();

        vm.prank(unauthorized);
        vm.expectRevert();
        sentinel.transferToDistributor(serialHash, distributor, "Illicit handover");
    }

    function test_RevertWhenDispensingExpiredMedicine() public {
        _createDefaultBatchAndPack();

        vm.prank(manufacturer);
        sentinel.transferToDistributor(serialHash, distributor, "Dispatch");

        vm.prank(distributor);
        sentinel.transferToPharmacy(serialHash, pharmacy, "Arrival");

        // Warp time beyond expiration (1 year + 1 day)
        vm.warp(block.timestamp + 366 days);

        vm.prank(pharmacy);
        vm.expectRevert(abi.encodeWithSelector(MedSupplySentinel.MedicineExpired.selector, block.timestamp - 1 days));
        sentinel.dispenseToPatient(serialHash, keccak256("RX-001"));
    }

    function test_QuarantineBlocksDispensingAndFlagsVerification() public {
        _createDefaultBatchAndPack();

        // Regulator quarantines the batch
        vm.prank(regulator);
        regulatorGov.quarantine(batchId, false, "Suspected vial contamination investigation");

        // Verification outcome should immediately return QUARANTINED
        (MedSupplySentinel.VerificationOutcome outcome, string memory reason, , , , ) = sentinel.verifyMedicinePack(serialHash);
        assertEq(uint256(outcome), uint256(MedSupplySentinel.VerificationOutcome.QUARANTINED));
        assertEq(reason, "Suspected vial contamination investigation");

        // Attempting custody transfer while quarantined must revert
        vm.prank(manufacturer);
        vm.expectRevert(abi.encodeWithSelector(MedSupplySentinel.BatchUnderQuarantineOrRecall.selector, "Suspected vial contamination investigation"));
        sentinel.transferToDistributor(serialHash, distributor, "Attempt during quarantine");
    }

    function test_BatchMerkleProofAndZKReceiptAndSoulboundLock() public {
        _createDefaultBatchAndPack();

        uint256 tokenId = packNFT.serialToTokenId(serialHash);
        assertFalse(packNFT.locked(tokenId));

        // 1. Anchor single-leaf Merkle root on MedSupplySentinel and verify O(log N) inclusion
        uint256 expiresAt = block.timestamp + 365 days;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(batchId, serialHash, expiresAt))));
        vm.prank(manufacturer);
        sentinel.anchorBatchMerkleRoot(batchId, leaf);

        bytes32[] memory emptyProof = new bytes32[](0);
        (bool included, bytes32 computedLeaf, bytes32 anchoredRoot) = sentinel.verifyPackMerkleInclusion(
            batchId,
            serialHash,
            expiresAt,
            emptyProof
        );
        assertTrue(included);
        assertEq(computedLeaf, leaf);
        assertEq(anchoredRoot, leaf);

        // 2. Complete custody and dispense with ZK salted patient receipt commitment
        vm.prank(manufacturer);
        sentinel.transferToDistributor(serialHash, distributor, "Dispatch");
        vm.prank(distributor);
        sentinel.transferToPharmacy(serialHash, pharmacy, "Pharmacy Receipt");

        bytes32 rxHash = keccak256("RX-2026-88412");
        bytes32 salt = keccak256("PATIENT-BLINDING-SALT-9941");
        bytes32 zkCommitment = keccak256(
            abi.encodePacked("MEDSUPPLY_ZK_RX_V1", serialHash, rxHash, salt)
        );

        vm.prank(pharmacy);
        sentinel.dispenseToPatient(serialHash, zkCommitment);

        // 3. ERC-5192 Soulbound Lock must be engaged automatically upon DISPENSED
        assertTrue(packNFT.locked(tokenId));

        // Attempting custodian update on Soulbound-locked token must revert
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(MedicinePackNFT.PackSoulboundLocked.selector, tokenId));
        packNFT.updateCustodian(tokenId, unauthorized);

        // 4. Verify ZK commitment succeeds with valid salt and rejects wrong salt
        (bool zkValid, ) = sentinel.verifyZKPatientReceiptCommitment(serialHash, rxHash, salt);
        assertTrue(zkValid);
        (bool zkInvalid, ) = sentinel.verifyZKPatientReceiptCommitment(serialHash, rxHash, keccak256("WRONG"));
        assertFalse(zkInvalid);
    }

    function test_MultiSigRegulatorRecallGovernance() public {
        _createDefaultBatchAndPack();
        address secondRegulator = address(0xEE9);

        vm.prank(admin);
        regulatorGov.grantRole(regulatorGov.REGULATOR_ROLE(), secondRegulator);

        // First regulator proposes Class I recall (1 of 2 approvals -> not executed yet)
        vm.prank(regulator);
        bytes32 propId = regulatorGov.proposeRecall(
            batchId,
            RegulatorGovernance.RecallSeverity.CLASS_I,
            "Sterility failure co-sign required",
            "https://fda.gov/recalls/2026-001"
        );
        (, bool recalledBefore, ) = regulatorGov.isCompromised(batchId, serialHash);
        assertFalse(recalledBefore);

        // Second independent regulator approves (2 of 2 approvals -> recall executes)
        vm.prank(secondRegulator);
        regulatorGov.approveRecall(propId);

        (, bool recalledAfter, string memory reason) = regulatorGov.isCompromised(batchId, serialHash);
        assertTrue(recalledAfter);
        assertEq(reason, "Sterility failure co-sign required");
    }

    function _createDefaultBatchAndPack() internal {
        vm.startPrank(manufacturer);
        sentinel.createBatch(
            batchId,
            "GTIN-09384210",
            "PneumoGuard 13",
            100,
            block.timestamp + 365 days,
            200,
            800,
            3600
        );

        bytes32[] memory serials = new bytes32[](1);
        serials[0] = serialHash;

        string[] memory uris = new string[](1);
        uris[0] = "ipfs://QmSampleHashMetadata";

        sentinel.registerSerializedPacks(batchId, serials, uris);
        vm.stopPrank();
    }
}
