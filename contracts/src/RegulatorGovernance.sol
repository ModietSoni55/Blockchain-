// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RegulatorGovernance
 * @author MedSupply Sentinel Team
 * @notice Regulatory oversight contract enabling health authorities to enforce
 * emergency quarantines, mandatory recalls, and audit findings on supply-chain entities.
 */
contract RegulatorGovernance is AccessControl, Pausable {
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    enum RecallSeverity {
        CLASS_III, // Minor compliance or labeling defect
        CLASS_II,  // Temporary or medically reversible adverse health consequence
        CLASS_I    // Critical: Dangerous defect that can cause serious injury or death
    }

    struct QuarantineRecord {
        bytes32 targetId; // batchId or packSerialHash
        bool isPack;      // true if single pack, false if entire batch
        string reason;
        address authority;
        uint256 timestamp;
        bool isActive;
    }

    struct RecallRecord {
        bytes32 batchId;
        RecallSeverity severity;
        string reason;
        string publicNoticeURI;
        address issuedBy;
        uint256 timestamp;
        bool isActive;
    }

    // Mapping: targetId (batchId or serialHash) => QuarantineRecord
    mapping(bytes32 => QuarantineRecord) public quarantines;

    // Mapping: batchId => RecallRecord
    mapping(bytes32 => RecallRecord) public recalls;

    // Array of all recalled batch IDs
    bytes32[] public recalledBatches;

    // Multi-Sig Recall Governance (requires M independent REGULATOR_ROLE approvals for Class I recalls)
    uint256 public recallThreshold = 2;

    struct RecallProposal {
        bytes32 batchId;
        RecallSeverity severity;
        string reason;
        string publicNoticeURI;
        address proposer;
        uint256 approvalCount;
        bool executed;
    }

    mapping(bytes32 => RecallProposal) public recallProposals;
    mapping(bytes32 => mapping(address => bool)) public recallApprovals;

    event EntityQuarantined(
        bytes32 indexed targetId,
        bool isPack,
        string reason,
        address indexed authority,
        uint256 timestamp
    );

    event QuarantineLifted(
        bytes32 indexed targetId,
        address indexed authority,
        string justification,
        uint256 timestamp
    );

    event RecallProposed(
        bytes32 indexed proposalId,
        bytes32 indexed batchId,
        RecallSeverity severity,
        address indexed proposer
    );

    event RecallApproved(
        bytes32 indexed proposalId,
        bytes32 indexed batchId,
        address indexed coSigner,
        uint256 totalApprovals
    );

    event RecallIssued(
        bytes32 indexed batchId,
        RecallSeverity severity,
        string reason,
        string publicNoticeURI,
        address indexed authority,
        uint256 timestamp
    );

    event RecallClosed(
        bytes32 indexed batchId,
        address indexed authority,
        string notes,
        uint256 timestamp
    );

    error AlreadyQuarantined(bytes32 targetId);
    error NotQuarantined(bytes32 targetId);
    error AlreadyRecalled(bytes32 batchId);
    error NotRecalled(bytes32 batchId);
    error AlreadyApprovedRecall(bytes32 proposalId, address signer);
    error ProposalAlreadyExecuted(bytes32 proposalId);

    constructor(address admin) {
        require(admin != address(0), "Admin cannot be zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGULATOR_ROLE, admin);
        _grantRole(AUDITOR_ROLE, admin);
    }

    /**
     * @notice Proposes an M-of-N multi-signature recall requiring co-signers from REGULATOR_ROLE.
     */
    function proposeRecall(
        bytes32 batchId,
        RecallSeverity severity,
        string calldata reason,
        string calldata publicNoticeURI
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused returns (bytes32 proposalId) {
        if (recalls[batchId].isActive) {
            revert AlreadyRecalled(batchId);
        }

        proposalId = keccak256(abi.encodePacked(batchId, severity, reason, block.timestamp));
        recallProposals[proposalId] = RecallProposal({
            batchId: batchId,
            severity: severity,
            reason: reason,
            publicNoticeURI: publicNoticeURI,
            proposer: msg.sender,
            approvalCount: 1,
            executed: false
        });
        recallApprovals[proposalId][msg.sender] = true;

        emit RecallProposed(proposalId, batchId, severity, msg.sender);
        emit RecallApproved(proposalId, batchId, msg.sender, 1);

        if (recallThreshold <= 1) {
            _executeRecallProposal(proposalId);
        }
    }

    /**
     * @notice Co-signs a pending multi-signature recall proposal; automatically executes recall once threshold is met.
     */
    function approveRecall(bytes32 proposalId) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        RecallProposal storage prop = recallProposals[proposalId];
        require(prop.proposer != address(0), "Proposal does not exist");
        if (prop.executed) {
            revert ProposalAlreadyExecuted(proposalId);
        }
        if (recallApprovals[proposalId][msg.sender]) {
            revert AlreadyApprovedRecall(proposalId, msg.sender);
        }

        recallApprovals[proposalId][msg.sender] = true;
        prop.approvalCount += 1;

        emit RecallApproved(proposalId, prop.batchId, msg.sender, prop.approvalCount);

        if (prop.approvalCount >= recallThreshold) {
            _executeRecallProposal(proposalId);
        }
    }

    function _executeRecallProposal(bytes32 proposalId) internal {
        RecallProposal storage prop = recallProposals[proposalId];
        prop.executed = true;

        recalls[prop.batchId] = RecallRecord({
            batchId: prop.batchId,
            severity: prop.severity,
            reason: prop.reason,
            publicNoticeURI: prop.publicNoticeURI,
            issuedBy: msg.sender,
            timestamp: block.timestamp,
            isActive: true
        });
        recalledBatches.push(prop.batchId);

        emit RecallIssued(
            prop.batchId,
            prop.severity,
            prop.reason,
            prop.publicNoticeURI,
            msg.sender,
            block.timestamp
        );
    }

    function setRecallThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold >= 1, "Threshold must be >= 1");
        recallThreshold = newThreshold;
    }

    /**
     * @notice Quarantines an entire batch or specific pack serial.
     */
    function quarantine(
        bytes32 targetId,
        bool isPack,
        string calldata reason
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        if (quarantines[targetId].isActive) {
            revert AlreadyQuarantined(targetId);
        }

        quarantines[targetId] = QuarantineRecord({
            targetId: targetId,
            isPack: isPack,
            reason: reason,
            authority: msg.sender,
            timestamp: block.timestamp,
            isActive: true
        });

        emit EntityQuarantined(targetId, isPack, reason, msg.sender, block.timestamp);
    }

    /**
     * @notice Lifts quarantine following completed laboratory remediation or inspection.
     */
    function liftQuarantine(
        bytes32 targetId,
        string calldata justification
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        if (!quarantines[targetId].isActive) {
            revert NotQuarantined(targetId);
        }

        quarantines[targetId].isActive = false;

        emit QuarantineLifted(targetId, msg.sender, justification, block.timestamp);
    }

    /**
     * @notice Issues an official Class I/II/III recall for a batch.
     */
    function issueRecall(
        bytes32 batchId,
        RecallSeverity severity,
        string calldata reason,
        string calldata publicNoticeURI
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        if (recalls[batchId].isActive) {
            revert AlreadyRecalled(batchId);
        }

        recalls[batchId] = RecallRecord({
            batchId: batchId,
            severity: severity,
            reason: reason,
            publicNoticeURI: publicNoticeURI,
            issuedBy: msg.sender,
            timestamp: block.timestamp,
            isActive: true
        });

        recalledBatches.push(batchId);

        emit RecallIssued(
            batchId,
            severity,
            reason,
            publicNoticeURI,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Closes a completed recall campaign.
     */
    function closeRecall(
        bytes32 batchId,
        string calldata notes
    ) external onlyRole(REGULATOR_ROLE) whenNotPaused {
        if (!recalls[batchId].isActive) {
            revert NotRecalled(batchId);
        }

        recalls[batchId].isActive = false;

        emit RecallClosed(batchId, msg.sender, notes, block.timestamp);
    }

    /**
     * @notice Checks if an entity is currently quarantined or part of an active recall.
     */
    function isCompromised(
        bytes32 batchId,
        bytes32 packSerialHash
    ) external view returns (bool quarantined, bool recalled, string memory reason) {
        if (quarantines[packSerialHash].isActive) {
            return (true, false, quarantines[packSerialHash].reason);
        }
        if (quarantines[batchId].isActive) {
            return (true, false, quarantines[batchId].reason);
        }
        if (recalls[batchId].isActive) {
            return (false, true, recalls[batchId].reason);
        }
        return (false, false, "");
    }

    function getRecallsCount() external view returns (uint256) {
        return recalledBatches.length;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
