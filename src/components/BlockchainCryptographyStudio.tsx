import React, { useState, useMemo, useEffect } from 'react';
import {
  Shield,
  Lock,
  CheckCircle2,
  XCircle,
  GitBranch,
  FileCode2,
  Blocks,
  KeyRound,
  Fingerprint,
  Network,
  FileCheck2,
  Unlock,
} from 'lucide-react';
import {
  BatchRecord,
  MedicinePackRecord,
  CustodyEvent,
  TelemetryEvent,
  CommandAuditRecord,
  RoleType,
  ShamirShareRecord,
  canRoleExecuteAction,
  buildBatchMerkleTree,
  generateMerkleInclusionProof,
  computeEIP712AttestationDigest,
  createZKPrescriptionCommitment,
  verifyZKPrescriptionCommitment,
  createNIZKPrescriptionProof,
  verifyNIZKPrescriptionProof,
  buildHashChainedBlocks,
  deriveDeterministicPUFPrint,
  perturbPUFBits,
  computePUFHammingMatch,
  decryptShamirShareECIES,
  reconstructSecretShamir,
  createSelectiveDisclosureVC,
  verifySelectiveDisclosureVC,
  analyzeCustodyGraphDiversion,
} from '../utils/sentinelLogic';
import { ROLE_SIGNERS } from '../utils/commandSigner';

export interface EvmStatusInfo {
  connected: boolean;
  mode: string;
  rpcUrl: string;
  chainId: number;
  blockNumber: string;
}

interface BlockchainCryptographyStudioProps {
  batches: BatchRecord[];
  packs: MedicinePackRecord[];
  custodyEvents: CustodyEvent[];
  telemetry?: TelemetryEvent[];
  auditLog?: CommandAuditRecord[];
  evmStatus?: EvmStatusInfo | null;
  ledgerVersion?: number;
  issuerPublicAddress?: string;
  prefillZkWitness?: { serial: string; rxId: string; salt: string } | null;
  onProbeEvmRpc?: () => void;
  activeRole?: RoleType;
  onAnchorBatchMerkleRoot?: (batchId: string, merkleRoot: string) => void;
  onAuditBreakGlassShamir?: (
    serialNumber: string,
    shareIndices: number[],
    unsealedShares?: ShamirShareRecord[]
  ) => Promise<void>;
}

type CryptoTab = 'merkle' | 'eip712' | 'zkp' | 'blocks' | 'shamir_puf';

export const BlockchainCryptographyStudio: React.FC<BlockchainCryptographyStudioProps> = ({
  batches,
  packs,
  custodyEvents,
  telemetry = [],
  auditLog = [],
  evmStatus = null,
  ledgerVersion = 1,
  issuerPublicAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  prefillZkWitness = null,
  onProbeEvmRpc,
  activeRole = 'MANUFACTURER',
  onAnchorBatchMerkleRoot,
  onAuditBreakGlassShamir,
}) => {
  const [activeTab, setActiveTab] = useState<CryptoTab>('merkle');

  // Merkle Tree & Inclusion Proof state
  const [selectedBatchId, setSelectedBatchId] = useState<string>(batches[0]?.batchId || '');
  const [selectedSerialForProof, setSelectedSerialForProof] = useState<string>(
    packs[0]?.serialNumber || 'SN-PCV20-2026-0001'
  );
  const [tamperLeafMode, setTamperLeafMode] = useState<boolean>(false);
  const [anchorSuccessMsg, setAnchorSuccessMsg] = useState<string>('');
  const [anchorErrorMsg, setAnchorErrorMsg] = useState<string>('');

  // Zero-Knowledge Prescription Receipt Commitment state
  const [zkSerial, setZkSerial] = useState<string>(packs[0]?.serialNumber || 'SN-PCV20-2026-0001');
  const [zkPrescriptionId, setZkPrescriptionId] = useState<string>('RX-2026-88412');
  const [zkPatientSalt, setZkPatientSalt] = useState<string>('PATIENT-BLINDING-SALT-9941');
  const [zkVerifierSaltInput, setZkVerifierSaltInput] = useState<string>(
    'PATIENT-BLINDING-SALT-9941'
  );

  // W3C Selective-Disclosure Verifiable Credential (SD-VC) state
  const [sdRevealKeys, setSdRevealKeys] = useState<string[]>([
    'productName',
    'authenticity',
    'coldChainCompliant',
  ]);

  // Shamir (2,3) Finite-Field Break-Glass + ECIES Custodian Unlock + PUF Twin-Tag state
  const [shamirPackSerial, setShamirPackSerial] = useState<string>(
    packs.find((p) => (p.shamirRecallShares?.length ?? 0) > 0)?.serialNumber ||
      'SN-PCV20-2026-0005'
  );
  const [selectedShareIndices, setSelectedShareIndices] = useState<number[]>([1, 3]);
  const [unlockedSharesByKey, setUnlockedSharesByKey] = useState<Record<string, ShamirShareRecord>>(
    {}
  );
  const [nizkTamperMode, setNizkTamperMode] = useState<boolean>(false);
  const [shamirAuditFeedback, setShamirAuditFeedback] = useState<string>('');
  const [pufSimDriftBits, setPufSimDriftBits] = useState<number>(6);

  useEffect(() => {
    if (prefillZkWitness) {
      setZkSerial(prefillZkWitness.serial);
      setZkPrescriptionId(prefillZkWitness.rxId);
      setZkPatientSalt(prefillZkWitness.salt);
      setZkVerifierSaltInput(prefillZkWitness.salt);
      setActiveTab('zkp');
    }
  }, [prefillZkWitness]);

  const activeBatch = useMemo(
    () => batches.find((b) => b.batchId === selectedBatchId) || batches[0],
    [batches, selectedBatchId]
  );

  const batchPacks = useMemo(
    () => packs.filter((p) => p.batchId === activeBatch?.batchId),
    [packs, activeBatch]
  );

  const merkleTreeData = useMemo(() => {
    if (!activeBatch) return { merkleRoot: '0x0', leaves: [], layers: [] };
    return buildBatchMerkleTree(batchPacks, activeBatch.expiresAt);
  }, [batchPacks, activeBatch]);

  const merkleProofResult = useMemo(() => {
    if (!activeBatch) return null;
    const effectiveSerial = tamperLeafMode
      ? `${selectedSerialForProof}-FORGED`
      : selectedSerialForProof;
    return generateMerkleInclusionProof(effectiveSerial, batchPacks, activeBatch.expiresAt);
  }, [activeBatch, batchPacks, selectedSerialForProof, tamperLeafMode]);

  const activePackForEip712 = useMemo(
    () =>
      packs.find((p) => p.serialNumber === selectedSerialForProof) ||
      batchPacks[0] ||
      packs[0],
    [packs, batchPacks, selectedSerialForProof]
  );

  const eip712Attestation = useMemo(() => {
    if (!activePackForEip712 || !activeBatch) return null;
    return computeEIP712AttestationDigest({
      serialNumber: activePackForEip712.serialNumber,
      serialHash: activePackForEip712.serialHash,
      batchId: activePackForEip712.batchId,
      expiresAt: activeBatch.expiresAt,
      nonce: activePackForEip712.nonce,
      status: activePackForEip712.status,
      chainId: 31337,
    });
  }, [activePackForEip712, activeBatch]);

  const zkCommitment = useMemo(
    () => createZKPrescriptionCommitment(zkSerial, zkPrescriptionId, zkPatientSalt),
    [zkSerial, zkPrescriptionId, zkPatientSalt]
  );

  const matchedOnChainDispensedPack = useMemo(
    () =>
      packs.find(
        (p) =>
          p.serialNumber.toLowerCase() === zkSerial.trim().toLowerCase() &&
          Boolean(p.dispensedToReceipt)
      ),
    [packs, zkSerial]
  );

  const expectedOnChainZkCommitment =
    matchedOnChainDispensedPack?.dispensedToReceipt || zkCommitment.commitmentHash;

  const zkVerificationValid = useMemo(
    () =>
      verifyZKPrescriptionCommitment(
        zkSerial,
        zkPrescriptionId,
        zkVerifierSaltInput,
        expectedOnChainZkCommitment
      ),
    [zkSerial, zkPrescriptionId, zkVerifierSaltInput, expectedOnChainZkCommitment]
  );

  // Pedersen-Schnorr secp256k1 Non-Interactive Zero-Knowledge Proof (NIZK)
  const nizkProofData = useMemo(() => {
    const raw = createNIZKPrescriptionProof(zkSerial, zkPrescriptionId, zkVerifierSaltInput);
    const evaluated = nizkTamperMode
      ? {
          ...raw,
          responseS1Hex: `0x${'ff'.repeat(32)}`,
        }
      : raw;
    return {
      proof: evaluated,
      isValid: verifyNIZKPrescriptionProof(evaluated),
    };
  }, [zkSerial, zkPrescriptionId, zkVerifierSaltInput, nizkTamperMode]);

  const hashChainedBlocks = useMemo(
    () => buildHashChainedBlocks(custodyEvents),
    [custodyEvents]
  );

  // SD-VC Verifiable Credential computation
  const sdPack = useMemo(
    () =>
      packs.find((p) => p.serialNumber === zkSerial) ||
      packs.find((p) => p.status === 'DISPENSED') ||
      packs[0],
    [packs, zkSerial]
  );
  const sdBatch = useMemo(
    () => batches.find((b) => b.batchId === sdPack?.batchId) || batches[0],
    [batches, sdPack]
  );
  const sdVerifiableCredential = useMemo(() => {
    if (!sdPack || !sdBatch) return null;
    return createSelectiveDisclosureVC(sdPack, sdBatch, telemetry, sdRevealKeys);
  }, [sdPack, sdBatch, telemetry, sdRevealKeys]);
  const sdVcVerification = useMemo(() => {
    if (!sdVerifiableCredential) return null;
    return verifySelectiveDisclosureVC(sdVerifiableCredential);
  }, [sdVerifiableCredential]);

  // Shamir (2,3) Reconstruction & ECIES Custodian Decryption computation
  const shamirPack = useMemo(
    () =>
      packs.find((p) => p.serialNumber === shamirPackSerial && (p.shamirRecallShares?.length ?? 0) > 0) ||
      packs.find((p) => (p.shamirRecallShares?.length ?? 0) > 0) ||
      packs[0],
    [packs, shamirPackSerial]
  );
  const shamirShares = useMemo(() => shamirPack?.shamirRecallShares || [], [shamirPack]);

  const getCustodianPrivateKey = (shareIndex: number): string | undefined => {
    if (shareIndex === 1) {
      return ROLE_SIGNERS.find((s) => s.role === 'PHARMACY')?.anvilDevPrivateKey;
    }
    if (shareIndex === 2) {
      return ROLE_SIGNERS.find((s) => s.role === 'MANUFACTURER')?.anvilDevPrivateKey;
    }
    return ROLE_SIGNERS.find((s) => s.role === 'REGULATOR')?.anvilDevPrivateKey;
  };

  // Pre-decrypt Custodian #1 (Pharmacy) and #3 (Regulator) for active pack on load while keeping #2 Sealed
  useEffect(() => {
    if (!shamirPack || shamirShares.length === 0) return;
    setUnlockedSharesByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const share of shamirShares) {
        const keyId = `${shamirPack.serialNumber}:${share.index}`;
        if (share.index !== 2 && share.isSealedECIES && share.eciesEnvelope && !next[keyId]) {
          const priv = getCustodianPrivateKey(share.index);
          if (priv) {
            try {
              const chunks = decryptShamirShareECIES(share.eciesEnvelope, priv);
              next[keyId] = { ...share, yChunksHex: chunks, isSealedECIES: false };
              changed = true;
            } catch {
              // Ignore if mismatched key
            }
          }
        }
      }
      return changed ? next : prev;
    });
  }, [shamirPack, shamirShares]);

  const resolvedShamirShares = useMemo(() => {
    if (!shamirPack) return [];
    return shamirShares.map((s) => {
      const keyId = `${shamirPack.serialNumber}:${s.index}`;
      return unlockedSharesByKey[keyId] || s;
    });
  }, [shamirPack, shamirShares, unlockedSharesByKey]);

  const shamirReconResult = useMemo(() => {
    const active = resolvedShamirShares.filter((s) => selectedShareIndices.includes(s.index));
    return reconstructSecretShamir(active, 2);
  }, [resolvedShamirShares, selectedShareIndices]);

  const pufInspection = useMemo(() => {
    const targetPack = activePackForEip712 || packs[0];
    if (!targetPack) return null;
    const anchored =
      targetPack.pufSealHash ||
      deriveDeterministicPUFPrint(targetPack.serialNumber, targetPack.batchId);
    const scanned = perturbPUFBits(anchored, pufSimDriftBits);
    return {
      serialNumber: targetPack.serialNumber,
      ...computePUFHammingMatch(anchored, scanned),
    };
  }, [activePackForEip712, packs, pufSimDriftBits]);

  const custodyDiversion = useMemo(
    () => analyzeCustodyGraphDiversion(packs, custodyEvents),
    [packs, custodyEvents]
  );

  const isCurrentBatchAnchored = Boolean(
    activeBatch?.anchoredMerkleRoot &&
      activeBatch.anchoredMerkleRoot.toLowerCase() === merkleTreeData.merkleRoot.toLowerCase()
  );

  const handleAnchorRoot = () => {
    if (!activeBatch) return;
    setAnchorErrorMsg('');
    setAnchorSuccessMsg('');

    const rbac = canRoleExecuteAction(activeRole, 'ANCHOR_MERKLE_ROOT');
    if (!rbac.allowed) {
      setAnchorErrorMsg(
        rbac.reason ||
          `AccessControl: Only MANUFACTURER_ROLE can anchor a batch Merkle root (active: ${activeRole}).`
      );
      return;
    }

    if (onAnchorBatchMerkleRoot) {
      onAnchorBatchMerkleRoot(activeBatch.batchId, merkleTreeData.merkleRoot);
    }
    setAnchorSuccessMsg(
      `Anchored Merkle Root ${merkleTreeData.merkleRoot.slice(0, 18)}... on MedSupplySentinel.sol for ${activeBatch.batchCode} (persisted to disk ledger).`
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      {/* Studio Header & Sub-Technique Switcher */}
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-slate-100">
              Cryptographic Verification &amp; Privacy Proof Studio
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Interactive tools showing how MedSupply Sentinel proves pack authenticity, blocks tampering, and protects patient privacy using mathematical proofs.
          </p>
        </div>

        <div className="inline-flex flex-wrap p-1 bg-slate-950 border border-slate-800 rounded-lg gap-1 w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('merkle')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'merkle'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            1. Batch Verification (Merkle)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('eip712')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'eip712'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            2. Digital Seal &amp; Lock
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('zkp')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'zkp'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            3. Patient Privacy (ZK)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('blocks')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'blocks'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            <Blocks className="w-3.5 h-3.5" />
            4. Audit Ledger &amp; Blocks
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shamir_puf')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'shamir_puf'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            5. Recall Key, Seal &amp; Routes
          </button>
        </div>
      </div>

      {/* TAB 1: BATCH MERKLE TREE & O(log N) INCLUSION PROOFS */}
      {activeTab === 'merkle' && activeBatch && (
        <div className="space-y-4">
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300">
            <strong className="text-emerald-300">What this proves: </strong>
            Instead of storing millions of individual pack IDs on-chain, the manufacturer anchors one compact Batch Merkle Root. Any pack can prove it belongs to that batch in a few quick hash steps—even offline.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
              <div className="text-xs font-semibold text-slate-200">
                Choose a Batch &amp; Pack to Test Membership Proof
              </div>

              <div>
                <label
                  htmlFor="merkle-batch-select"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Target Manufacturing Batch
                </label>
                <select
                  id="merkle-batch-select"
                  value={activeBatch.batchId}
                  onChange={(e) => {
                    const nextBatchId = e.target.value;
                    setSelectedBatchId(nextBatchId);
                    const firstInBatch = packs.find((p) => p.batchId === nextBatchId);
                    if (firstInBatch) setSelectedSerialForProof(firstInBatch.serialNumber);
                    setAnchorSuccessMsg('');
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
                >
                  {batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {b.batchCode} — {b.brandName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="merkle-pack-select"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Serialized Pack Leaf ({batchPacks.length} leaves in batch tree)
                </label>
                <select
                  id="merkle-pack-select"
                  value={selectedSerialForProof}
                  onChange={(e) => {
                    setSelectedSerialForProof(e.target.value);
                    setTamperLeafMode(false);
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
                >
                  {batchPacks.map((p, idx) => (
                    <option key={p.serialNumber} value={p.serialNumber}>
                      Leaf #{idx}: {p.serialNumber} ({p.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleAnchorRoot}
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                >
                  Anchor Batch Merkle Root On-Chain
                </button>
                <button
                  type="button"
                  onClick={() => setTamperLeafMode((prev) => !prev)}
                  className={`py-2 px-3 font-semibold text-xs rounded-lg border transition-colors ${
                    tamperLeafMode
                      ? 'bg-rose-950/70 border-rose-600 text-rose-300'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {tamperLeafMode ? 'Restore Authentic Leaf' : 'Simulate Unregistered Leaf'}
                </button>
              </div>

              {anchorErrorMsg && (
                <p className="text-xs text-rose-400 font-mono">{anchorErrorMsg}</p>
              )}
              {anchorSuccessMsg && (
                <p className="text-xs text-emerald-400 font-mono">{anchorSuccessMsg}</p>
              )}
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-xs font-mono">
              <div className="text-slate-400">Batch Merkle Root (OpenZeppelin Standard)</div>
              <div className="text-emerald-400 break-all">{merkleTreeData.merkleRoot}</div>
              <div className="pt-2 flex justify-between text-slate-400 border-t border-slate-800">
                <span>Tree Depth: {merkleTreeData.layers.length} levels</span>
                <span className={isCurrentBatchAnchored ? 'text-emerald-400 font-bold' : ''}>
                  On-Chain Status:{' '}
                  {isCurrentBatchAnchored
                    ? `ANCHORED (${activeBatch.merkleAnchoredAt?.slice(0, 10) || 'PERSISTED'})`
                    : 'READY TO ANCHOR'}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {merkleProofResult && (
              <div
                className={`p-5 rounded-xl border ${
                  merkleProofResult.isVerified
                    ? 'bg-emerald-950/25 border-emerald-700/60'
                    : 'bg-rose-950/25 border-rose-700/60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {merkleProofResult.isVerified ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <div className="text-xs font-mono text-slate-400">
                        MerkleProof.verify(proof, batchMerkleRoot, leafHash)
                      </div>
                      <h3 className="text-sm font-bold text-slate-100 mt-0.5">
                        {merkleProofResult.isVerified
                          ? `VALID INCLUSION PROOF — Pack ${merkleProofResult.serialNumber} Verified in O(log N)`
                          : `INVALID MERKLE PROOF — ${merkleProofResult.serialNumber} Not Included in Batch Root`}
                      </h3>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    {merkleProofResult.proofSiblings.length} sibling hash(es)
                  </span>
                </div>

                <div className="mt-4 space-y-2.5 font-mono text-xs">
                  <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded">
                    <span className="text-slate-400 block">Double-Hashed Leaf Node:</span>
                    <span className="text-slate-200 break-all">{merkleProofResult.leafHash}</span>
                  </div>

                  {/* Interactive Visual Binary Merkle Tree Diagram */}
                  {merkleTreeData.layers.length > 0 && (
                    <div className="p-3 bg-slate-950/95 border border-slate-800 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>Visual Binary Merkle Tree (Root ← Intermediate ← Leaves)</span>
                        <span
                          className={
                            merkleProofResult.isVerified ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {merkleProofResult.isVerified ? 'Inclusion Path Valid' : 'Forged Leaf Rejected'}
                        </span>
                      </div>
                      <div className="space-y-2 pt-1">
                        {[...merkleTreeData.layers].reverse().map((layer, revIdx) => {
                          const layerIdx = merkleTreeData.layers.length - 1 - revIdx;
                          const isRootLayer = layerIdx === merkleTreeData.layers.length - 1;
                          const isLeafLayer = layerIdx === 0;
                          return (
                            <div key={layerIdx} className="flex flex-wrap items-center justify-center gap-2">
                              {layer.map((hash, nodeIdx) => {
                                const isTargetLeaf =
                                  isLeafLayer &&
                                  hash.toLowerCase() === merkleProofResult.leafHash.toLowerCase();
                                const isRootMatched = isRootLayer && merkleProofResult.isVerified;
                                const isSiblingInProof = merkleProofResult.proofSiblings.some(
                                  (s) => s.toLowerCase() === hash.toLowerCase()
                                );
                                return (
                                  <div
                                    key={`${layerIdx}-${nodeIdx}`}
                                    className={`px-2 py-1 rounded border text-[10px] font-mono transition-colors ${
                                      isTargetLeaf || isRootMatched
                                        ? 'bg-emerald-950/60 border-emerald-500/70 text-emerald-300 font-semibold'
                                        : isSiblingInProof
                                        ? 'bg-sky-950/50 border-sky-600/60 text-sky-300'
                                        : 'bg-slate-900 border-slate-800 text-slate-400'
                                    }`}
                                    title={hash}
                                  >
                                    {isRootLayer
                                      ? `ROOT ${hash.slice(0, 8)}..`
                                      : isLeafLayer
                                      ? `${batchPacks[nodeIdx]?.serialNumber.slice(-4) || `L${nodeIdx}`}: ${hash.slice(0, 8)}..`
                                      : `H${layerIdx}.${nodeIdx}: ${hash.slice(0, 8)}..`}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {merkleProofResult.proofSiblings.length > 0 ? (
                    <div className="space-y-1.5">
                      <span className="text-slate-400 block">
                        Merkle Path Sibling Hashes (Leaf → Root):
                      </span>
                      {merkleProofResult.proofSiblings.map((sib, idx) => (
                        <div
                          key={`${sib}-${idx}`}
                          className="p-2 bg-slate-950/90 border border-slate-800 rounded flex items-center justify-between gap-2"
                        >
                          <span className="text-slate-400">Level {idx + 1} Sibling:</span>
                          <span className="text-emerald-300 truncate">{sib}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-950/90 border border-slate-800 rounded text-slate-400">
                      {merkleProofResult.isVerified
                        ? 'Single-leaf batch tree: Leaf hash equals Batch Merkle Root directly.'
                        : 'No valid Merkle path exists for this forged/unregistered serial number.'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* TAB 2: EIP-712 TYPED STRUCTURED DATA & ERC-5192 SOULBOUND LOCK */}
      {activeTab === 'eip712' && eip712Attestation && activePackForEip712 && (
        <div className="space-y-4">
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300">
            <strong className="text-emerald-300">What this proves: </strong>
            Every medicine pack carries a tamper-proof EIP-712 digital signature and an ERC-5192 Soulbound Lock so once dispensed to a patient, the pack token can never be resold or transferred again.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 space-y-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  EIP-712 Domain & Struct TypeHash Inspector
                </span>
                <span className="text-xs font-mono text-emerald-400">EIP-712 v4</span>
              </div>

              <div>
                <label
                  htmlFor="eip712-pack-select"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Inspect Serialized Pack Passport
                </label>
                <select
                  id="eip712-pack-select"
                  value={activePackForEip712.serialNumber}
                  onChange={(e) => setSelectedSerialForProof(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
                >
                  {packs.map((p) => (
                    <option key={p.serialNumber} value={p.serialNumber}>
                      {p.serialNumber} — {p.status} (Token #{p.tokenId})
                    </option>
                  ))}
                </select>
              </div>

              <pre className="p-3 bg-slate-900 border border-slate-800 rounded text-[11px] font-mono text-slate-200 overflow-x-auto">
{JSON.stringify(
  {
    domain: eip712Attestation.domain,
    primaryType: 'PackAttestation',
    message: eip712Attestation.message,
  },
  null,
  2
)}
              </pre>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3 text-xs font-mono">
              <div>
                <span className="text-slate-400 block">domainSeparatorV4():</span>
                <span className="text-slate-200 break-all">
                  {eip712Attestation.domainSeparatorHash}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">PackAttestation StructHash:</span>
                <span className="text-slate-200 break-all">{eip712Attestation.structHash}</span>
              </div>
              <div>
                <span className="text-slate-400 block">
                  Final EIP-712 Signing Digest (keccak256(&quot;\x19\x01&quot; || domain || struct)):
                </span>
                <span className="text-emerald-400 break-all">
                  {eip712Attestation.eip712Digest}
                </span>
              </div>
            </div>

            {/* ERC-5192 Soulbound Lock Card */}
            <div
              className={`p-4 rounded-lg border ${
                eip712Attestation.isSoulboundLocked
                  ? 'bg-amber-950/30 border-amber-700/60'
                  : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock
                    className={`w-4 h-4 ${
                      eip712Attestation.isSoulboundLocked ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  />
                  <span className="text-xs font-bold text-slate-100">
                    ERC-5192 Soulbound Token (SBT) Transfer Lock
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-200">
                  locked({activePackForEip712.tokenId}) ={' '}
                  {eip712Attestation.isSoulboundLocked ? 'true' : 'false'}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                {eip712Attestation.isSoulboundLocked
                  ? `Token #${activePackForEip712.tokenId} (${activePackForEip712.serialNumber}) has reached terminal status (${activePackForEip712.status}) and emitted Locked(${activePackForEip712.tokenId}). Any subsequent transfer reverts with PackSoulboundLocked(${activePackForEip712.tokenId}).`
                  : `Token #${activePackForEip712.tokenId} is currently ${activePackForEip712.status} and transferable only by authorized CONTROLLER_ROLE signers until dispensed to a patient.`}
              </p>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* TAB 3: ZERO-KNOWLEDGE (ZK) PRESCRIPTION & W3C SELECTIVE-DISCLOSURE VERIFIABLE CREDENTIAL */}
      {activeTab === 'zkp' && (
        <div className="space-y-6">
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300">
            <strong className="text-emerald-300">What this proves: </strong>
            Patients can prove a pharmacy legitimately dispensed their medicine—and share only selected safety facts at customs or clinics—without revealing their name or prescription ID on the blockchain.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
                <div className="text-xs font-semibold text-slate-200">
                  Private Prescription Receipt Check (Zero-Knowledge)
                </div>
                <p className="text-xs text-slate-400">
                  Pharmacies commit{' '}
                  <code className="text-emerald-300 font-mono">
                    H(&quot;MEDSUPPLY_ZK_RX_V1&quot; || serialHash || rxHash || patientSalt)
                  </code>{' '}
                  on-chain so patients can prove ownership of a dispensed pack without storing raw
                  patient names or prescription numbers on the public ledger.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label htmlFor="zk-serial-input" className="block text-slate-400 mb-1">
                      Medicine Pack Serial
                    </label>
                    <input
                      id="zk-serial-input"
                      type="text"
                      value={zkSerial}
                      onChange={(e) => setZkSerial(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label htmlFor="zk-rx-input" className="block text-slate-400 mb-1">
                      Private Prescription ID
                    </label>
                    <input
                      id="zk-rx-input"
                      type="text"
                      value={zkPrescriptionId}
                      onChange={(e) => setZkPrescriptionId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label htmlFor="zk-salt-input" className="block text-slate-400 mb-1">
                    Patient Secret Blinding Salt (Kept Off-Chain on Patient Device)
                  </label>
                  <input
                    id="zk-salt-input"
                    type="text"
                    value={zkPatientSalt}
                    onChange={(e) => {
                      setZkPatientSalt(e.target.value);
                      setZkVerifierSaltInput(e.target.value);
                    }}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3 text-xs font-mono">
                <div>
                  <span className="text-slate-400 block">
                    {matchedOnChainDispensedPack
                      ? `On-Chain Stored Commitment (${matchedOnChainDispensedPack.serialNumber} · DISPENSED):`
                      : 'Generated Commitment Preview (dispensedReceipts[serialHash]):'}
                  </span>
                  <span className="text-emerald-400 break-all">{expectedOnChainZkCommitment}</span>
                </div>

                <div className="pt-3 border-t border-slate-800">
                  <label htmlFor="zk-verify-salt" className="block text-slate-400 mb-1 font-sans">
                    Verify Zero-Knowledge Witness Salt (Try modifying to test rejection):
                  </label>
                  <input
                    id="zk-verify-salt"
                    type="text"
                    value={zkVerifierSaltInput}
                    onChange={(e) => setZkVerifierSaltInput(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
                  />
                </div>

                <div
                  className={`p-3 rounded border flex items-center gap-2 ${
                    zkVerificationValid
                      ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-700/60 text-rose-300'
                  }`}
                >
                  {zkVerificationValid ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {zkVerificationValid
                      ? 'ZK Commitment Verified: Patient witness matches on-chain receipt hash with zero PII exposure.'
                      : 'ZK Commitment Mismatch: Invalid blinding salt or prescription witness rejected.'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Pedersen-Schnorr secp256k1 Non-Interactive Zero-Knowledge Proof (NIZK) */}
          <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  Pedersen-Schnorr secp256k1 Non-Interactive Zero-Knowledge Proof (NIZK)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Proves opening knowledge of Pedersen Commitment{' '}
                  <code className="text-emerald-300 font-mono">C = w·G + r·H</code> via Fiat-Shamir challenge{' '}
                  <code className="text-emerald-300 font-mono">s₁·G + s₂·H + c·C == R</code> without ever revealing witness{' '}
                  <code className="text-slate-200 font-mono">(RxID, Salt)</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNizkTamperMode((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono border shrink-0 transition-colors ${
                  nizkTamperMode
                    ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-700/70 text-rose-300'
                }`}
              >
                {nizkTamperMode ? 'Restore Valid NIZK Proof' : 'Tamper Scalar s₁ (Attack Test)'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5">
                <div className="text-slate-400">Pedersen Commitment Point C (secp256k1):</div>
                <div className="text-emerald-300 break-all">{nizkProofData.proof.commitmentPoint}</div>
                <div className="text-slate-400 pt-1">Schnorr Announcement R = k₁·G + k₂·H:</div>
                <div className="text-slate-200 break-all">{nizkProofData.proof.announcementR}</div>
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5">
                <div className="text-slate-400">Fiat-Shamir Challenge c = Keccak256(serial || C || R || H):</div>
                <div className="text-sky-300 break-all">{nizkProofData.proof.challengeHex}</div>
                <div className="text-slate-400 pt-1">Masked Responses (s₁, s₂):</div>
                <div className="text-slate-300 break-all">
                  s₁: {nizkProofData.proof.responseS1Hex.slice(0, 28)}... · s₂:{' '}
                  {nizkProofData.proof.responseS2Hex.slice(0, 28)}...
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
              <div
                className={`flex items-center gap-2 ${
                  nizkProofData.isValid ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {nizkProofData.isValid ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {nizkProofData.isValid
                    ? 'EC EQUATION VERIFIED: s₁·G + s₂·H + c·C == R (Zero-Knowledge Soundness Confirmed)'
                    : 'NIZK VERIFICATION FAILED: Elliptic curve equality s₁·G + s₂·H + c·C != R'}
                </span>
              </div>
              <span className="text-slate-400">
                Witness (RxID &amp; Salt) Transmitted: NONE — Pure Zero-Knowledge
              </span>
            </div>
          </div>

          {/* W3C Selective-Disclosure Verifiable Credential (SD-VC Merkle Claims Passport) */}
          {sdVerifiableCredential && sdVcVerification && (
            <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-sky-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      W3C Selective-Disclosure Verifiable Pharmaceutical Credential (SD-VC)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Toggle which fields to disclose vs. mathematically redact via Salted Claims Merkle Proofs for customs, border control, or insurance.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono text-emerald-400 shrink-0">
                  {sdVcVerification.valid
                    ? `MERKLE VC VALID (${sdVcVerification.revealedVerifiedCount} Disclosed · ${sdVcVerification.redactedCount} Redacted)`
                    : 'VC MERKLE MISMATCH'}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 space-y-2">
                  {sdVerifiableCredential.claims.map((claim) => {
                    const checked = sdRevealKeys.includes(claim.key);
                    return (
                      <label
                        key={claim.key}
                        className="flex items-center justify-between p-2.5 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer hover:border-slate-700 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSdRevealKeys((prev) =>
                                checked ? prev.filter((k) => k !== claim.key) : [...prev, claim.key]
                              )
                            }
                            className="accent-emerald-500"
                          />
                          <span className="text-slate-200 font-medium">{claim.label}</span>
                        </div>
                        <span
                          className={`font-mono text-[11px] ${
                            checked ? 'text-emerald-300' : 'text-slate-500'
                          }`}
                        >
                          {checked ? 'DISCLOSED' : 'REDACTED HASH'}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="lg:col-span-7">
                  <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-200 overflow-x-auto max-h-60">
                    {JSON.stringify(
                      {
                        type: sdVerifiableCredential.type,
                        issuer: sdVerifiableCredential.issuer,
                        subjectSerial: sdVerifiableCredential.subjectSerial,
                        claimsMerkleRoot: sdVerifiableCredential.claimsMerkleRoot,
                        disclosedClaims: sdVerifiableCredential.claims.map((c) => ({
                          claim: c.key,
                          status: c.revealed ? 'REVEALED' : 'REDACTED',
                          value: c.revealed ? c.value : `[COMMITMENT:${c.leafHash.slice(0, 14)}...]`,
                          merkleProofSiblings: c.merkleProof.length,
                        })),
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: HASH-CHAINED EVM BLOCK HEADER, LIVE RPC ADAPTER & EIP-712 AUDIT LOG */}
      {activeTab === 'blocks' && (
        <div className="space-y-6">
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 font-sans">
            <strong className="text-emerald-300">What this proves: </strong>
            Every custody change and recall decision is cryptographically linked to the previous block and verified against signer permissions so past records cannot be silently rewritten. (Ledger v{ledgerVersion} · Issuer Key {issuerPublicAddress.slice(0, 10)}...)
          </div>
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
            <div className="space-y-1">
              <div className="text-slate-300">
                Blockchain Connection:{' '}
                <span className={evmStatus?.connected ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                  {evmStatus?.connected
                    ? `Connected to Local EVM Node (Chain ${evmStatus.chainId} · Block #${evmStatus.blockNumber})`
                    : `Persistent Signed Ledger Active (v${ledgerVersion})`}
                </span>
              </div>
              <div className="text-slate-400">
                RPC Endpoint: {evmStatus?.rpcUrl || 'http://127.0.0.1:8545'} · Authenticated Commands:{' '}
                {auditLog.length}
              </div>
            </div>
            {onProbeEvmRpc && (
              <button
                type="button"
                onClick={onProbeEvmRpc}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300 rounded-lg whitespace-nowrap shrink-0"
              >
                Probe Anvil / EVM RPC
              </button>
            )}
          </div>

          {/* Visual Hash-Chained Block Sequence Strip */}
          {hashChainedBlocks.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
              {hashChainedBlocks.slice(0, 4).map((blk) => (
                <div
                  key={blk.blockNumber}
                  className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 font-bold">Block #{blk.blockNumber}</span>
                    <span className="text-[11px] text-slate-400 tabular-nums">
                      {blk.gasUsed.toLocaleString()} gas
                    </span>
                  </div>
                  <div className="text-slate-200 truncate text-[11px]">{blk.primaryAction}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    Hash: {blk.blockHash.slice(0, 14)}...
                  </div>
                  <div className="text-[10px] text-sky-400/90 truncate">
                    ← Prev: {blk.parentBlockHash.slice(0, 14)}...
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Block #</th>
                  <th className="py-2.5 px-3">Block Hash / Parent Hash</th>
                  <th className="py-2.5 px-3">State Root</th>
                  <th className="py-2.5 px-3">Contract Call & Custody Transition</th>
                  <th className="py-2.5 px-3 text-right">Gas Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {hashChainedBlocks.slice(0, 10).map((blk) => (
                  <tr key={blk.blockNumber} className="hover:bg-slate-950/60">
                    <td className="py-3 px-3 font-bold text-emerald-400 tabular-nums">
                      #{blk.blockNumber}
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-slate-100">
                        Hash: {blk.blockHash.slice(0, 18)}...{blk.blockHash.slice(-6)}
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Prev: {blk.parentBlockHash.slice(0, 18)}...{blk.parentBlockHash.slice(-6)}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {blk.stateRoot.slice(0, 16)}...
                    </td>
                    <td className="py-3 px-3 font-sans">
                      <span className="font-mono text-emerald-300">{blk.primaryAction}</span>
                      <span className="block text-slate-400 text-[11px]">{blk.actorSummary}</span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-300 tabular-nums">
                      {blk.gasUsed.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {auditLog.length > 0 && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Server-Verified EIP-712 Command Audit Log (ecrecover &amp; Replay Guard)
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-[11px]">
                {auditLog.slice(0, 8).map((entry) => (
                  <div
                    key={entry.id}
                    className="p-2.5 bg-slate-900 border border-slate-800/80 rounded flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <span className="text-emerald-400 font-bold">v{entry.version}</span> ·{' '}
                      <span className="text-slate-100">{entry.action}</span> ·{' '}
                      <span className="text-slate-400">{entry.summary}</span>
                    </div>
                    <div className="text-slate-400 shrink-0">
                      Signer: {entry.signerAddress.slice(0, 8)}... ({entry.signerRole}) · Sig:{' '}
                      {entry.eip712Signature.slice(0, 10)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: SHAMIR (2,3) FINITE-FIELD BREAK-GLASS, PUF OPTICAL TWIN-TAG & CUSTODY DIVERSION GRAPH */}
      {activeTab === 'shamir_puf' && (
        <div className="space-y-6">
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300">
            <strong className="text-emerald-300">What this proves: </strong>
            (1) Patient contact info stays split across 3 encrypted keys so 2 authorities must agree during an emergency recall, (2) 256-bit optical foil matching detects photocopied QR stickers, and (3) route graph checks catch grey-market diversion.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 6 Cols: 2-of-3 Shamir Threshold Secret Sharing over GF(2^127-1) */}
            <div className="lg:col-span-6 p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    2-of-3 Emergency Recall Key Vault (Shamir)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Protects patient privacy until an emergency: at least 2 of 3 custodians (Pharmacy, Manufacturer, Regulator) must unlock their key shares to contact a patient.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-sky-400 shrink-0">
                  {shamirReconResult.primeFieldLabel}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <label htmlFor="shamir-pack-select" className="block text-slate-400">
                  Dispensed Pack Vault Target
                </label>
                <select
                  id="shamir-pack-select"
                  value={shamirPack?.serialNumber || ''}
                  onChange={(e) => {
                    setShamirPackSerial(e.target.value);
                    setShamirAuditFeedback('');
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg font-mono text-slate-100"
                >
                  {packs
                    .filter((p) => (p.shamirRecallShares?.length ?? 0) > 0)
                    .map((p) => (
                      <option key={p.serialNumber} value={p.serialNumber}>
                        {p.serialNumber} ({p.status}) — 3 Threshold Shares Anchored
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-2">
                {resolvedShamirShares.map((share) => {
                  const selected = selectedShareIndices.includes(share.index);
                  const isSealed = Boolean(share.isSealedECIES || share.yChunksHex.length === 0);
                  const keyId = `${shamirPack?.serialNumber || ''}:${share.index}`;
                  return (
                    <div
                      key={share.index}
                      className={`p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                        selected
                          ? 'bg-emerald-950/25 border-emerald-700/60'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            setSelectedShareIndices((prev) =>
                              selected
                                ? prev.filter((i) => i !== share.index)
                                : [...prev, share.index]
                            )
                          }
                          className="accent-emerald-500"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-100">{share.custodianLabel}</div>
                          <div className="font-mono text-[10px] text-slate-400 truncate">
                            {isSealed
                              ? `SEALED_ECIES_AES_MAC: ${share.eciesEnvelope?.ciphertextHex.slice(0, 22) || 'ENCRYPTED'}...`
                              : `Decrypted Share f(${share.index}) = ${share.yChunksHex[0]?.slice(0, 18)}...`}
                          </div>
                        </div>
                      </label>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono text-[10px] ${
                            isSealed ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {isSealed ? 'SEALED_ECIES' : 'UNSEALED'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (isSealed && share.eciesEnvelope) {
                              const priv = getCustodianPrivateKey(share.index);
                              if (priv) {
                                const chunks = decryptShamirShareECIES(share.eciesEnvelope, priv);
                                setUnlockedSharesByKey((prev) => ({
                                  ...prev,
                                  [keyId]: { ...share, yChunksHex: chunks, isSealedECIES: false },
                                }));
                              }
                            } else if (shamirPack) {
                              const originalSealed = shamirShares.find((s) => s.index === share.index);
                              if (originalSealed?.isSealedECIES) {
                                setUnlockedSharesByKey((prev) => {
                                  const next = { ...prev };
                                  delete next[keyId];
                                  return next;
                                });
                              }
                            }
                          }}
                          className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px] flex items-center gap-1"
                        >
                          {isSealed ? (
                            <>
                              <Unlock className="w-3 h-3 text-emerald-400" />
                              Unlock ECIES Share
                            </>
                          ) : (
                            <>
                              <Lock className="w-3 h-3 text-amber-400" />
                              Seal Share
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                className={`p-3.5 rounded-lg border text-xs font-mono space-y-1.5 ${
                  shamirReconResult.ok
                    ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-300'
                    : 'bg-amber-950/30 border-amber-700/60 text-amber-300'
                }`}
              >
                <div className="font-bold">
                  {shamirReconResult.ok
                    ? `LAGRANGE INTERPOLATION UNLOCKED (${shamirReconResult.sharesUsed}/3 Shares)`
                    : shamirReconResult.error}
                </div>
                {shamirReconResult.ok && (
                  <>
                    <div className="text-slate-100">
                      Recovered Token: &quot;{shamirReconResult.recoveredSecret}&quot;
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {shamirReconResult.lagrangeCoefficients.join(' · ')}
                    </div>
                  </>
                )}
              </div>

              {onAuditBreakGlassShamir && shamirPack && shamirReconResult.ok && (
                <button
                  type="button"
                  onClick={async () => {
                    setShamirAuditFeedback('');
                    try {
                      const unsealedSelected = resolvedShamirShares.filter(
                        (s) => selectedShareIndices.includes(s.index) && s.yChunksHex.length > 0
                      );
                      await onAuditBreakGlassShamir(
                        shamirPack.serialNumber,
                        selectedShareIndices,
                        unsealedSelected
                      );
                      setShamirAuditFeedback(
                        `Committed immutable SHAMIR_BREAK_GLASS_AUDIT event for ${shamirPack.serialNumber}.`
                      );
                    } catch (err) {
                      setShamirAuditFeedback(err instanceof Error ? err.message : String(err));
                    }
                  }}
                  className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                >
                  Commit On-Chain Break-Glass Audit Event (REGULATOR_ROLE)
                </button>
              )}
              {shamirAuditFeedback && (
                <p className="text-[11px] font-mono text-sky-300">{shamirAuditFeedback}</p>
              )}
            </div>

            {/* Right 6 Cols: 256-bit Optical PUF Micro-Seal Hamming Inspector */}
            <div className="lg:col-span-6 p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Optical PUF Twin-Tag Anti-Photocopy Engine
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Binds the digital ECDSA QR to a physical 256-bit seal fiber vector evaluated via{' '}
                    <code className="text-emerald-300 font-mono">verifyPUFOpticalSeal()</code> XOR Hamming popcount.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                  Max Drift &le; 24 bits
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Simulate Optical Seal Scan Noise / Spoof</span>
                  <span className="font-mono text-sky-300 tabular-nums">{pufSimDriftBits} bits flipped</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Authentic Seal (6-bit jitter)', bits: 6 },
                    { label: 'Damaged Foil (40-bit drift)', bits: 40 },
                    { label: 'Photocopy Clone (108-bit spoof)', bits: 108 },
                  ].map((preset) => (
                    <button
                      key={preset.bits}
                      type="button"
                      onClick={() => setPufSimDriftBits(preset.bits)}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                        pufSimDriftBits === preset.bits
                          ? 'bg-sky-500 text-slate-950 border-sky-400 font-semibold'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {pufInspection && (
                <div className="space-y-3 text-xs font-mono">
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5">
                    <div className="text-slate-400">
                      On-Chain Anchored PUF ({pufInspection.serialNumber}):
                    </div>
                    <div className="text-emerald-400 break-all text-[11px]">
                      {pufInspection.anchoredPufHash}
                    </div>
                    <div className="text-slate-400 pt-1">Live Optical Scan Digest:</div>
                    <div className="text-sky-300 break-all text-[11px]">
                      {pufInspection.scannedPufHash}
                    </div>
                  </div>

                  <div
                    className={`p-3.5 rounded-lg border flex items-center justify-between ${
                      pufInspection.verdict === 'GENUINE_OPTICAL_SEAL'
                        ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-300'
                        : pufInspection.verdict === 'SUSPECT_OPTICAL_DRIFT'
                        ? 'bg-amber-950/30 border-amber-700/60 text-amber-300'
                        : 'bg-rose-950/30 border-rose-700/60 text-rose-300'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{pufInspection.verdict}</div>
                      <div className="text-[11px] opacity-90">
                        Bitwise XOR Hamming Distance: {pufInspection.bitDrift} / {pufInspection.totalBits} bits
                      </div>
                    </div>
                    <span className="text-base font-bold tabular-nums">
                      {pufInspection.similarityPct}% match
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Full-Width Card: Custody Provenance Graph Markov Diversion Forensics */}
          <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Custody Provenance Graph &amp; Grey-Market Diversion Forensics
                  </h3>
                  <p className="text-xs text-slate-400">
                    {custodyDiversion.diversionAlertSummary}
                  </p>
                </div>
              </div>
              <div className="font-mono text-xs shrink-0">
                Graph Integrity:{' '}
                <span
                  className={`font-bold ${
                    custodyDiversion.integrityScore >= 85 ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {custodyDiversion.integrityScore}%
                </span>{' '}
                · {custodyDiversion.totalTransitions} edges
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {custodyDiversion.edges.map((edge) => (
                <div
                  key={edge.id}
                  className={`p-3 rounded-lg border space-y-1 ${
                    edge.isAnomaly
                      ? 'bg-rose-950/25 border-rose-700/60'
                      : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className={edge.isAnomaly ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                      {edge.fromRole} → {edge.toRole}
                    </span>
                    <span className="text-slate-400 tabular-nums">{edge.count} tx</span>
                  </div>
                  <div className="text-slate-200 truncate">
                    {edge.fromActor} → {edge.toActor}
                  </div>
                  {edge.anomalyReason && (
                    <div className="text-[11px] text-rose-300 leading-snug">
                      {edge.anomalyReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
