// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ColdChainOracle.sol";

contract ColdChainOracleTest is Test {
    ColdChainOracle public oracle;

    address public admin = address(0xAA1);
    uint256 public reporterPrivateKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    address public reporter;
    address public unauthorized = address(0x999);

    bytes32 public batchId = keccak256("BATCH-COLD-CHAIN-TEST");

    function setUp() public {
        reporter = vm.addr(reporterPrivateKey);

        vm.startPrank(admin);
        oracle = new ColdChainOracle(admin);
        oracle.grantRole(oracle.REPORTER_ROLE(), reporter);
        oracle.setBatchProfile(batchId, 200, 800, 3600); // 2.00°C to 8.00°C
        vm.stopPrank();
    }

    function test_RecordSafeTelemetry() public {
        vm.prank(reporter);
        bool breach = oracle.recordTelemetry(
            batchId,
            450, // 4.50°C (Safe)
            6000, // 60.00%
            40712800,
            -74006000,
            block.timestamp,
            "SENSOR-RIG-001"
        );

        assertFalse(breach);
        assertFalse(oracle.isBatchBreached(batchId));
        assertEq(oracle.getReadingsCount(batchId), 1);
    }

    function test_TransientExcursionWarnsThenBreachesAfterMaxExcursionSeconds() public {
        // Transient out-of-bounds reading starts excursion clock (within 3600s tolerance)
        vm.prank(reporter);
        bool firstBreach = oracle.recordTelemetry(
            batchId,
            1450, // 14.50°C
            5500,
            40712800,
            -74006000,
            block.timestamp,
            "SENSOR-RIG-001"
        );
        assertFalse(firstBreach);
        assertFalse(oracle.isBatchBreached(batchId));

        // Sustained excursion exceeding 3600s triggers permanent breach
        vm.prank(reporter);
        bool sustainedBreach = oracle.recordTelemetry(
            batchId,
            1480, // 14.80°C
            5600,
            40712800,
            -74006000,
            block.timestamp + 3700,
            "SENSOR-RIG-001"
        );
        assertTrue(sustainedBreach);
        assertTrue(oracle.isBatchBreached(batchId));
    }

    function test_ZeroToleranceBatchSubcoolingBreachesImmediately() public {
        bytes32 zeroTolBatch = keccak256("BATCH-ZERO-TOLERANCE");
        vm.prank(admin);
        oracle.setBatchProfile(zeroTolBatch, 200, 800, 0);

        vm.prank(reporter);
        bool breach = oracle.recordTelemetry(
            zeroTolBatch,
            -150, // -1.50°C (< 2.00°C)
            5500,
            40712800,
            -74006000,
            block.timestamp,
            "SENSOR-RIG-001"
        );

        assertTrue(breach);
        assertTrue(oracle.isBatchBreached(zeroTolBatch));
    }

    function test_RevertWhenUnauthorizedRecordsTelemetry() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        oracle.recordTelemetry(
            batchId,
            500,
            6000,
            40712800,
            -74006000,
            block.timestamp,
            "ROGUE-SENSOR"
        );
    }

    function test_SignedTelemetryWithECDSAVerification() public {
        int16 temp = 520; // 5.20°C
        uint16 hum = 5800;
        int32 lat = 40712800;
        int32 lon = -74006000;
        uint256 ts = block.timestamp;
        string memory devId = "CRYPTO-SENSOR-09";

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                batchId,
                temp,
                hum,
                lat,
                lon,
                ts,
                devId,
                block.chainid
            )
        );

        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(msgHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reporterPrivateKey, ethSigned);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Submit signed telemetry from ANY caller (the signature authenticates the sensor)
        vm.prank(unauthorized);
        bool breach = oracle.recordSignedTelemetry(
            batchId,
            temp,
            hum,
            lat,
            lon,
            ts,
            devId,
            sig
        );

        assertFalse(breach);
        assertEq(oracle.getReadingsCount(batchId), 1);
    }
}
