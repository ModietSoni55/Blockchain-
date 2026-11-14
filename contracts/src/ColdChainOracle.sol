// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title ColdChainOracle
 * @author MedSupply Sentinel Team
 * @notice Decoupled oracle contract managing cold-chain telemetry and threshold breaches.
 * @dev Accepts cryptographically signed or permissioned IoT sensor readings.
 * Temperatures are stored scaled by 100 (e.g., 2.50°C -> 250, -1.25°C -> -125).
 */
contract ColdChainOracle is AccessControl, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    struct TemperatureProfile {
        int16 minTemp; // Scaled by 100, e.g., 200 for 2.00°C
        int16 maxTemp; // Scaled by 100, e.g., 800 for 8.00°C
        uint32 maxExcursionSeconds; // Max cumulative excursion time before automatic breach
        bool exists;
    }

    struct SensorReading {
        bytes32 batchId;
        int16 temperature;
        uint16 humidity; // Scaled by 100 (e.g. 65.50% = 6550)
        int32 latitude; // Scaled by 1e6
        int32 longitude; // Scaled by 1e6
        uint256 timestamp;
        string deviceId;
        bool isBreached;
    }

    // Mapping: batchId => TemperatureProfile
    mapping(bytes32 => TemperatureProfile) public batchProfiles;

    // Mapping: batchId => Array of SensorReadings
    mapping(bytes32 => SensorReading[]) private _batchReadings;

    // Mapping: batchId => whether a confirmed thermal breach occurred
    mapping(bytes32 => bool) public isBatchBreached;

    // Cumulative thermal excursion tracking per batch (enforces TemperatureProfile.maxExcursionSeconds)
    mapping(bytes32 => uint256) public excursionStartTimestamp;
    mapping(bytes32 => uint256) public cumulativeExcursionSeconds;

    // Nonce tracking to prevent sensor message replay attacks
    mapping(bytes32 => bool) public usedReadingHashes;

    event ProfileConfigured(
        bytes32 indexed batchId,
        int16 minTemp,
        int16 maxTemp,
        uint32 maxExcursionSeconds
    );

    event TelemetryRecorded(
        bytes32 indexed batchId,
        int16 temperature,
        uint16 humidity,
        int32 latitude,
        int32 longitude,
        uint256 timestamp,
        string deviceId,
        bool isBreached
    );

    event ExcursionWarningRecorded(
        bytes32 indexed batchId,
        int16 recordedTemp,
        uint256 cumulativeSeconds,
        uint32 maxAllowedSeconds
    );

    event ColdChainBreachDetected(
        bytes32 indexed batchId,
        int16 recordedTemp,
        int16 limitViolated,
        uint256 timestamp,
        string reason
    );

    error ProfileAlreadyExists(bytes32 batchId);
    error ProfileNotFound(bytes32 batchId);
    error InvalidTemperatureRange();
    error ReplayReadingDetected();
    error InvalidOracleSignature();

    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
        _grantRole(REPORTER_ROLE, admin);
    }

    /**
     * @notice Registers safe thermal parameters for a batch.
     */
    function setBatchProfile(
        bytes32 batchId,
        int16 minTemp,
        int16 maxTemp,
        uint32 maxExcursionSeconds
    ) external onlyRole(ORACLE_ROLE) {
        if (minTemp >= maxTemp) {
            revert InvalidTemperatureRange();
        }

        batchProfiles[batchId] = TemperatureProfile({
            minTemp: minTemp,
            maxTemp: maxTemp,
            maxExcursionSeconds: maxExcursionSeconds,
            exists: true
        });

        emit ProfileConfigured(batchId, minTemp, maxTemp, maxExcursionSeconds);
    }

    /**
     * @notice Ingests direct telemetry from an authorized reporter node or IoT gateway.
     */
    function recordTelemetry(
        bytes32 batchId,
        int16 temperature,
        uint16 humidity,
        int32 latitude,
        int32 longitude,
        uint256 timestamp,
        string calldata deviceId
    ) external onlyRole(REPORTER_ROLE) whenNotPaused returns (bool breachOccurred) {
        return _processReading(
            batchId,
            temperature,
            humidity,
            latitude,
            longitude,
            timestamp,
            deviceId
        );
    }

    /**
     * @notice Ingests IoT telemetry verified via cryptographic ECDSA signature from hardware sensor.
     */
    function recordSignedTelemetry(
        bytes32 batchId,
        int16 temperature,
        uint16 humidity,
        int32 latitude,
        int32 longitude,
        uint256 timestamp,
        string calldata deviceId,
        bytes calldata signature
    ) external whenNotPaused returns (bool breachOccurred) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                batchId,
                temperature,
                humidity,
                latitude,
                longitude,
                timestamp,
                deviceId,
                block.chainid
            )
        );

        if (usedReadingHashes[messageHash]) {
            revert ReplayReadingDetected();
        }
        usedReadingHashes[messageHash] = true;

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);

        if (!hasRole(REPORTER_ROLE, signer) && !hasRole(ORACLE_ROLE, signer)) {
            revert InvalidOracleSignature();
        }

        return _processReading(
            batchId,
            temperature,
            humidity,
            latitude,
            longitude,
            timestamp,
            deviceId
        );
    }

    function _processReading(
        bytes32 batchId,
        int16 temperature,
        uint16 humidity,
        int32 latitude,
        int32 longitude,
        uint256 timestamp,
        string memory deviceId
    ) internal returns (bool breachOccurred) {
        TemperatureProfile memory profile = batchProfiles[batchId];
        if (!profile.exists) {
            revert ProfileNotFound(batchId);
        }

        bool outOfBounds = temperature < profile.minTemp || temperature > profile.maxTemp;
        bool breached = false;

        if (outOfBounds) {
            if (excursionStartTimestamp[batchId] == 0) {
                excursionStartTimestamp[batchId] = timestamp;
            } else if (timestamp > excursionStartTimestamp[batchId]) {
                cumulativeExcursionSeconds[batchId] += (timestamp - excursionStartTimestamp[batchId]);
                excursionStartTimestamp[batchId] = timestamp;
            }

            if (
                profile.maxExcursionSeconds == 0 ||
                cumulativeExcursionSeconds[batchId] > profile.maxExcursionSeconds
            ) {
                breached = true;
                isBatchBreached[batchId] = true;
                emit ColdChainBreachDetected(
                    batchId,
                    temperature,
                    temperature < profile.minTemp ? profile.minTemp : profile.maxTemp,
                    timestamp,
                    temperature < profile.minTemp
                        ? "Sub-cooling excursion exceeded maxExcursionSeconds"
                        : "Over-heating excursion exceeded maxExcursionSeconds"
                );
            } else {
                emit ExcursionWarningRecorded(
                    batchId,
                    temperature,
                    cumulativeExcursionSeconds[batchId],
                    profile.maxExcursionSeconds
                );
            }
        } else {
            // Safe reading closes current excursion window without erasing historical cumulative seconds
            excursionStartTimestamp[batchId] = 0;
        }

        _batchReadings[batchId].push(
            SensorReading({
                batchId: batchId,
                temperature: temperature,
                humidity: humidity,
                latitude: latitude,
                longitude: longitude,
                timestamp: timestamp,
                deviceId: deviceId,
                isBreached: breached
            })
        );

        emit TelemetryRecorded(
            batchId,
            temperature,
            humidity,
            latitude,
            longitude,
            timestamp,
            deviceId,
            breached
        );

        return breached;
    }

    function getReadingsCount(bytes32 batchId) external view returns (uint256) {
        return _batchReadings[batchId].length;
    }

    function getLatestReading(bytes32 batchId) external view returns (SensorReading memory) {
        uint256 len = _batchReadings[batchId].length;
        if (len == 0) {
            return SensorReading({
                batchId: batchId,
                temperature: 0,
                humidity: 0,
                latitude: 0,
                longitude: 0,
                timestamp: 0,
                deviceId: "",
                isBreached: false
            });
        }
        return _batchReadings[batchId][len - 1];
    }

    function getReadingAtIndex(bytes32 batchId, uint256 index)
        external
        view
        returns (SensorReading memory)
    {
        require(index < _batchReadings[batchId].length, "Index out of bounds");
        return _batchReadings[batchId][index];
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
