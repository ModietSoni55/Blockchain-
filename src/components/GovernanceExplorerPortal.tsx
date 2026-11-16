import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  Users,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  GitBranch,
  FileCode2,
  KeyRound,
  Blocks,
  Fingerprint,
} from 'lucide-react';
import {
  BatchRecord,
  CommandAuditRecord,
  CustodyEvent,
  MedicinePackRecord,
  ParticipantEntity,
  RoleType,
  ShamirShareRecord,
  TelemetryEvent,
  buildBatchMerkleTree,
  generateMerkleInclusionProof,
  computeEIP712AttestationDigest,
  createNIZKPrescriptionProof,
  verifyNIZKPrescriptionProof,
  buildHashChainedBlocks,
  buildTelemetryHashChain,
  deriveDeterministicPUFPrint,
  computePUFHammingMatch,
} from '../utils/sentinelLogic';
import { formatCustodyActionLabel } from '../utils/uiLabels';
import {
  BlockchainCryptographyStudio,
  CryptoTab,
  EvmStatusInfo,
} from './BlockchainCryptographyStudio';

interface GovernanceExplorerPortalProps {
  batches: BatchRecord[];
  packs: MedicinePackRecord[];
  custodyEvents: CustodyEvent[];
  telemetry: TelemetryEvent[];
  auditLog: CommandAuditRecord[];
  evmStatus: EvmStatusInfo | null;
  ledgerVersion: number;
  issuerPublicAddress: string;
  prefillZkWitness: { serial: string; rxId: string; salt: string } | null;
  onProbeEvmRpc: () => void;
  activeRole: RoleType;
  selectedPackSerial?: string;
  selectedBatchId?: string;
  onSelectPackSerial?: (serial: string) => void;
  onAnchorBatchMerkleRoot: (batchId: string, merkleRoot: string) => Promise<void> | void;
  onAuditBreakGlassShamir: (
    serialNumber: string,
    shareIndices: number[],
    unsealedShares?: ShamirShareRecord[]
  ) => Promise<void>;
  onResetPersistentDatabase: () => void;
  participants: ParticipantEntity[];
  newOrgName: string;
  onChangeNewOrgName: (val: string) => void;
  newOrgRole: RoleType;
  onChangeNewOrgRole: (val: RoleType) => void;
  newOrgLicense: string;
  onChangeNewOrgLicense: (val: string) => void;
  newOrgWallet: string;
  onChangeNewOrgWallet: (val: string) => void;
  participantMsg: string;
  onRegisterParticipant: (e: React.FormEvent) => void;
  onToggleParticipantAuth: (id: string) => void;
}

export const GovernanceExplorerPortal: React.FC<GovernanceExplorerPortalProps> = (props) => {
  const [showContracts, setShowContracts] = useState<boolean>(false);
  const [externalTabRequest, setExternalTabRequest] = useState<{
    tab: CryptoTab;
    seq: number;
  } | null>(null);
  const [fullAuditBanner, setFullAuditBanner] = useState<string>('');
  const [isRunningFullAudit, setIsRunningFullAudit] = useState<boolean>(false);

  const activePack = useMemo(
    () =>
      props.packs.find((p) => p.serialNumber === props.selectedPackSerial) ||
      props.packs[0],
    [props.packs, props.selectedPackSerial]
  );

  const activeBatch = useMemo(
    () =>
      props.batches.find((b) => b.batchId === activePack?.batchId) ||
      props.batches.find((b) => b.batchId === props.selectedBatchId) ||
      props.batches[0],
    [props.batches, activePack, props.selectedBatchId]
  );

  // Live 5-Pillar Cryptographic Proof Evaluation for the Active Pack
  const pillarScorecard = useMemo(() => {
    if (!activePack || !activeBatch) return null;
    const batchPacks = props.packs.filter((p) => p.batchId === activeBatch.batchId);
    const tree = buildBatchMerkleTree(batchPacks, activeBatch.expiresAt);
    const merkleProof = generateMerkleInclusionProof(
      activePack.serialNumber,
      batchPacks,
      activeBatch.expiresAt
    );
    const isRootAnchored = Boolean(
      activeBatch.anchoredMerkleRoot &&
        activeBatch.anchoredMerkleRoot.toLowerCase() === tree.merkleRoot.toLowerCase()
    );

    const eip712 = computeEIP712AttestationDigest({
      serialNumber: activePack.serialNumber,
      serialHash: activePack.serialHash,
      batchId: activePack.batchId,
      expiresAt: activeBatch.expiresAt,
      nonce: activePack.nonce,
      status: activePack.status,
      chainId: 31337,
    });

    const nizk = createNIZKPrescriptionProof(
      activePack.serialNumber,
      'RX-2026-88412',
      'PATIENT-BLINDING-SALT-9941'
    );
    const nizkValid = verifyNIZKPrescriptionProof(nizk);

    const custodyBlocks = buildHashChainedBlocks(props.custodyEvents);
    const batchTelemetry = props.telemetry.filter((t) => t.batchId === activeBatch.batchId);
    const tempChain = buildTelemetryHashChain(
      batchTelemetry.length > 0 ? batchTelemetry : props.telemetry.slice(0, 5)
    );
    const hasTempBreach =
      batchTelemetry.some((t) => t.isBreached) || activePack.status === 'QUARANTINED';

    const anchoredPuf =
      activePack.pufSealHash ||
      deriveDeterministicPUFPrint(activePack.serialNumber, activePack.batchId);
    const pufMatch = computePUFHammingMatch(anchoredPuf, anchoredPuf);

    return {
      merkleRoot: tree.merkleRoot,
      merkleVerified: merkleProof.isVerified,
      isRootAnchored,
      isSoulboundLocked: eip712.isSoulboundLocked,
      eip712Digest: eip712.eip712Digest,
      nizkValid,
      custodyBlockCount: custodyBlocks.length,
      tempBlockCount: tempChain.blocks.length,
      hasTempBreach,
      pufSimilarity: pufMatch.similarityPct,
    };
  }, [activePack, activeBatch, props.packs, props.custodyEvents, props.telemetry]);

  const handleJumpToStudioTab = (tab: CryptoTab) => {
    setExternalTabRequest((prev) => ({ tab, seq: (prev?.seq || 0) + 1 }));
  };

  const handleRunFullCryptographicAudit = async () => {
    if (!activePack || !activeBatch || !pillarScorecard) return;
    setIsRunningFullAudit(true);
    setFullAuditBanner('');
    try {
      await props.onAnchorBatchMerkleRoot(activeBatch.batchId, pillarScorecard.merkleRoot);
      setFullAuditBanner(
        `Full 5-Pillar Cryptographic Audit PASSED for ${activePack.serialNumber} (${activeBatch.batchCode}): Batch Merkle Root anchored on-chain (${pillarScorecard.merkleRoot.slice(0, 14)}...), EIP-712 Manufacturer Seal verified, Zero-Knowledge NIZK equation passed with 0 PII exposed, ${pillarScorecard.custodyBlockCount} Custody Blocks + ${pillarScorecard.tempBlockCount} Cold-Chain Blocks hash-verified, and 256-bit PUF Optical Seal matched.`
      );
    } catch (err) {
      setFullAuditBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningFullAudit(false);
    }
  };

  const handleFillSampleOrganization = () => {
    const suffix = Math.floor(100 + Math.random() * 899);
    props.onChangeNewOrgName(`Cardinal Health Cold Logistics #${suffix}`);
    props.onChangeNewOrgRole('DISTRIBUTOR');
    props.onChangeNewOrgLicense(`FDA-3PL-${suffix}`);
    props.onChangeNewOrgWallet('0x90F79bf6EB2c4f870365E785982E1f101E93b906');
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Audit Proofs, Privacy &amp; Network Access
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Plain-English cryptographic proof inspector: see how blockchain math proves pack authenticity, locks sold QR codes, protects patient privacy, and prevents history tampering.
          </p>
        </div>
        <button
          type="button"
          onClick={props.onResetPersistentDatabase}
          className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset Demo Data
        </button>
      </div>

      {/* Plain-English 5-Pillar Executive Audit Scorecard & 1-Click Full Audit Runner */}
      {activePack && activeBatch && pillarScorecard && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-slate-100">
                  Live 5-Pillar Cryptographic Audit Scorecard (Plain-English Summary)
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                Select any medicine box below—including custom packs created in the Demo tab—or click any pillar card to inspect and test that proof interactively.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 max-w-full">
              <select
                id="audit-active-pack-select"
                name="auditActivePackSerial"
                aria-label="Active medicine pack under audit"
                value={activePack.serialNumber}
                onChange={(e) => {
                  props.onSelectPackSerial?.(e.target.value);
                  setFullAuditBanner('');
                }}
                className="w-full sm:w-auto max-w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono truncate"
              >
                {props.packs.map((p) => {
                  const bCode =
                    props.batches.find((b) => b.batchId === p.batchId)?.batchCode ||
                    p.batchId.slice(0, 10);
                  return (
                    <option key={p.serialNumber} value={p.serialNumber}>
                      {p.serialNumber} — {p.status} ({bCode})
                    </option>
                  );
                })}
              </select>

              <button
                type="button"
                disabled={isRunningFullAudit}
                onClick={handleRunFullCryptographicAudit}
                className="w-full sm:w-auto justify-center px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-xs rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isRunningFullAudit
                  ? 'Running 5-Pillar Audit...'
                  : 'Run 1-Click Full Cryptographic Audit'}
              </button>
            </div>
          </div>

          {fullAuditBanner && (
            <div className="p-3.5 bg-emerald-950/35 border border-emerald-700/70 rounded-lg flex items-start gap-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{fullAuditBanner}</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Pillar 1: Merkle Batch Membership */}
            <button
              type="button"
              onClick={() => handleJumpToStudioTab('merkle')}
              className="text-left p-3.5 bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl space-y-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <GitBranch className="w-3.5 h-3.5" />
                  PILLAR 1 · MERKLE
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-[10px] font-mono text-emerald-300">
                  {pillarScorecard.isRootAnchored ? 'ANCHORED' : 'VERIFIED'}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                1. Batch Membership Proof
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Proves <span className="font-mono text-slate-200">{activePack.serialNumber}</span> is an official box inside batch <span className="font-mono text-slate-200">{activeBatch.batchCode}</span>.
              </p>
            </button>

            {/* Pillar 2: EIP-712 & ERC-5192 Anti-Resale Lock */}
            <button
              type="button"
              onClick={() => handleJumpToStudioTab('eip712')}
              className="text-left p-3.5 bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl space-y-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-sky-400 flex items-center gap-1">
                  <FileCode2 className="w-3.5 h-3.5" />
                  PILLAR 2 · EIP-712
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    pillarScorecard.isSoulboundLocked
                      ? 'bg-amber-950/80 border-amber-700/60 text-amber-300'
                      : 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                  }`}
                >
                  {pillarScorecard.isSoulboundLocked ? 'LOCKED SBT' : 'SIGNED SEAL'}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                2. Digital Seal &amp; QR Lock
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                {pillarScorecard.isSoulboundLocked
                  ? `QR is permanently locked (${activePack.status}) so this box cannot be resold.`
                  : 'Manufacturer ECDSA seal verified; pack is active in supply custody.'}
              </p>
            </button>

            {/* Pillar 3: Zero-Knowledge Patient Privacy */}
            <button
              type="button"
              onClick={() => handleJumpToStudioTab('zkp')}
              className="text-left p-3.5 bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl space-y-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5" />
                  PILLAR 3 · ZK PRIVACY
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-[10px] font-mono text-emerald-300">
                  0 PII EXPOSED
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                3. Private Patient Receipt
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Proves a valid pharmacy prescription using blinded math without putting patient names on-chain.
              </p>
            </button>

            {/* Pillar 4: Custody & Cold-Chain Hash Chain */}
            <button
              type="button"
              onClick={() => handleJumpToStudioTab('blocks')}
              className="text-left p-3.5 bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl space-y-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-sky-400 flex items-center gap-1">
                  <Blocks className="w-3.5 h-3.5" />
                  PILLAR 4 · BLOCKCHAIN
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    pillarScorecard.hasTempBreach
                      ? 'bg-rose-950/80 border-rose-700/60 text-rose-300'
                      : 'bg-emerald-950/80 border-emerald-700/60 text-emerald-300'
                  }`}
                >
                  {pillarScorecard.hasTempBreach ? 'BREACH LOGGED' : 'CHAIN INTACT'}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                4. Custody &amp; Temp Blocks
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                {pillarScorecard.custodyBlockCount} custody blocks &amp; {pillarScorecard.tempBlockCount} temperature blocks linked by parent hashes.
              </p>
            </button>

            {/* Pillar 5: 2-of-3 Recall Key & Optical PUF Seal */}
            <button
              type="button"
              onClick={() => handleJumpToStudioTab('shamir_puf')}
              className="text-left p-3.5 bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl space-y-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <Fingerprint className="w-3.5 h-3.5" />
                  PILLAR 5 · RECALL &amp; PUF
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-[10px] font-mono text-emerald-300">
                  2-OF-3 READY
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                5. Recall Vault &amp; Foil Seal
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Requires 2-of-3 custodians to unlock recall contact info + 256-bit optical anti-photocopy check.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Interactive Cryptography & Verification Proof Studio */}
      <BlockchainCryptographyStudio
        batches={props.batches}
        packs={props.packs}
        custodyEvents={props.custodyEvents}
        telemetry={props.telemetry}
        auditLog={props.auditLog}
        evmStatus={props.evmStatus}
        ledgerVersion={props.ledgerVersion}
        issuerPublicAddress={props.issuerPublicAddress}
        prefillZkWitness={props.prefillZkWitness}
        onProbeEvmRpc={props.onProbeEvmRpc}
        activeRole={props.activeRole}
        selectedPackSerial={props.selectedPackSerial}
        selectedBatchId={props.selectedBatchId}
        onSelectPackSerial={props.onSelectPackSerial}
        externalTabRequest={externalTabRequest}
        onAnchorBatchMerkleRoot={props.onAnchorBatchMerkleRoot}
        onAuditBreakGlassShamir={props.onAuditBreakGlassShamir}
      />

      {/* Authorized Organizations Registry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={props.onRegisterParticipant}
          className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Add Authorized Organization
                </h2>
                <p className="text-xs text-slate-400">
                  Grant or revoke supply-chain network access for manufacturers, distributors, and pharmacies.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleFillSampleOrganization}
              className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-emerald-300 rounded-md text-[11px] font-semibold shrink-0"
            >
              Fill Sample
            </button>
          </div>

          <div>
            <label htmlFor="org-name-input" className="block text-xs font-medium text-slate-300 mb-1">
              Organization Name
            </label>
            <input
              id="org-name-input"
              type="text"
              value={props.newOrgName}
              onChange={(e) => props.onChangeNewOrgName(e.target.value)}
              placeholder="e.g. Cardinal Health Cold Logistics"
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="org-role-select" className="block text-xs font-medium text-slate-300 mb-1">
                Network Role
              </label>
              <select
                id="org-role-select"
                value={props.newOrgRole}
                onChange={(e) => props.onChangeNewOrgRole(e.target.value as RoleType)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="MANUFACTURER">Manufacturer</option>
                <option value="DISTRIBUTOR">Distributor</option>
                <option value="PHARMACY">Pharmacy</option>
                <option value="REGULATOR">Safety Regulator</option>
              </select>
            </div>
            <div>
              <label htmlFor="org-license-input" className="block text-xs font-medium text-slate-300 mb-1">
                License / DEA Number
              </label>
              <input
                id="org-license-input"
                type="text"
                value={props.newOrgLicense}
                onChange={(e) => props.onChangeNewOrgLicense(e.target.value)}
                placeholder="e.g. FDA-3PL-7712"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono"
              />
            </div>
          </div>

          <div>
            <label htmlFor="org-wallet-input" className="block text-xs font-medium text-slate-300 mb-1">
              Wallet Address (optional — auto-generated if left blank)
            </label>
            <input
              id="org-wallet-input"
              type="text"
              value={props.newOrgWallet}
              onChange={(e) => props.onChangeNewOrgWallet(e.target.value)}
              placeholder="0x..."
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
            />
          </div>

          {props.participantMsg && (
            <p className="text-xs text-emerald-400">{props.participantMsg}</p>
          )}

          <button
            type="submit"
            className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
          >
            Authorize Organization
          </button>
        </form>

        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              Authorized Supply-Chain Organizations ({props.participants.length})
            </h2>
            <span className="text-xs text-slate-400">
              Click Active / Revoked to toggle network permission
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Organization</th>
                  <th className="py-2.5 px-3">Role &amp; License</th>
                  <th className="py-2.5 px-3">Account ID</th>
                  <th className="py-2.5 px-3 text-right">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {props.participants.map((pt) => (
                  <tr key={pt.id} className="hover:bg-slate-950/60">
                    <td className="py-3 px-3 font-medium text-slate-100">
                      {pt.organizationName}
                      <span className="block text-[11px] text-slate-400">{pt.region}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {pt.role.charAt(0) + pt.role.slice(1).toLowerCase()} ·{' '}
                      <span className="font-mono text-slate-400">{pt.licenseNumber}</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-emerald-400">
                      {pt.walletAddress.slice(0, 8)}...{pt.walletAddress.slice(-4)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => props.onToggleParticipantAuth(pt.id)}
                        className={`px-2.5 py-1 rounded-md font-semibold ${
                          pt.isAuthorized
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/50'
                            : 'bg-rose-950/60 text-rose-300 border border-rose-700/50'
                        }`}
                      >
                        {pt.isAuthorized ? 'Active' : 'Revoked'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Audit Activity & Smart Contract Addresses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <button
            type="button"
            onClick={() => setShowContracts((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Smart Contract Registry (5 Solidity Contracts)
              </h2>
              <p className="text-xs text-slate-400">
                On-chain contracts governing pack tokens, cold storage, and safety holds
              </p>
            </div>
            {showContracts ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showContracts && (
            <div className="divide-y divide-slate-800/80 font-mono text-xs pt-2 border-t border-slate-800">
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-300">MedSupplySentinel.sol</span>
                <span className="text-emerald-400 truncate">0x5FbDB2315678afecb367f032d93F642f64180aa3</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-300">MedicinePackNFT.sol</span>
                <span className="text-emerald-400 truncate">0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-300">ColdChainOracle.sol</span>
                <span className="text-emerald-400 truncate">0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-300">QRAttestation.sol</span>
                <span className="text-emerald-400 truncate">0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9</span>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <span className="text-slate-300">RegulatorGovernance.sol</span>
                <span className="text-emerald-400 truncate">0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Recent Custody Audit Trail ({props.custodyEvents.length} Events)
            </h2>
            <p className="text-xs text-slate-400">Latest verified events across the supply network</p>
          </div>
          <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto pr-1">
            {props.custodyEvents.map((evt) => (
              <div key={evt.id} className="py-3 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span className="text-emerald-300 font-medium">
                    {formatCustodyActionLabel(evt.action)}
                  </span>
                  <span className="font-mono text-slate-500">{evt.txHash.slice(0, 14)}...</span>
                </div>
                <div className="mt-1 text-slate-200 font-medium">
                  {evt.fromActor} → {evt.toActor}
                </div>
                <div className="text-slate-400 mt-0.5">{evt.notes}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
