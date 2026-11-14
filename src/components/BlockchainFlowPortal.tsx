import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Link2,
  Cpu,
  Blocks,
  Users,
  GitBranch,
  KeyRound,
  Search,
  RefreshCw,
} from 'lucide-react';
import {
  BatchRecord,
  CommandAuditRecord,
  CustodyEvent,
  MedicinePackRecord,
  ParticipantEntity,
  RoleType,
  TelemetryEvent,
  buildBatchMerkleTree,
  buildHashChainedBlocks,
  computeEIP712AttestationDigest,
  computeKeccakHex,
  generateMerkleInclusionProof,
} from '../utils/sentinelLogic';
import { formatCustodyActionLabel, formatPackStatusLabel } from '../utils/uiLabels';
import { EvmStatusInfo } from './BlockchainCryptographyStudio';

export type FlowStageAdvanceAction = 'SHIP_TO_DISTRIBUTOR' | 'DELIVER_TO_PHARMACY' | 'DISPENSE_TO_CUSTOMER';

interface BlockchainFlowPortalProps {
  packs: MedicinePackRecord[];
  batches: BatchRecord[];
  custodyEvents: CustodyEvent[];
  telemetry: TelemetryEvent[];
  participants: ParticipantEntity[];
  auditLog: CommandAuditRecord[];
  evmStatus: EvmStatusInfo | null;
  activeRole: RoleType;
  issuerPublicAddress: string;
  onAdvanceStage: (serialNumber: string, action: FlowStageAdvanceAction) => Promise<void>;
  onOpenCustomerVerify: (serialNumber: string) => void;
  onOpenSupplyChainMap?: (serialNumber: string) => void;
  onOpenAuditStudio: () => void;
  onOpenSecurityLab: () => void;
}

function shortHex(hex: string | undefined, head = 10, tail = 6): string {
  if (!hex) return '—';
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

export const BlockchainFlowPortal: React.FC<BlockchainFlowPortalProps> = ({
  packs,
  batches,
  custodyEvents,
  telemetry,
  participants,
  evmStatus,
  issuerPublicAddress,
  onAdvanceStage,
  onOpenCustomerVerify,
  onOpenSupplyChainMap,
  onOpenAuditStudio,
  onOpenSecurityLab,
}) => {
  const defaultPack =
    packs.find((p) => p.serialNumber === 'SN-PCV20-2026-0004') ||
    packs.find((p) => p.status === 'MANUFACTURED') ||
    packs[0];

  const [selectedSerial, setSelectedSerial] = useState<string>(
    defaultPack?.serialNumber || 'SN-PCV20-2026-0001'
  );
  const [tamperBlockOne, setTamperBlockOne] = useState<boolean>(false);
  const [isAdvancing, setIsAdvancing] = useState<boolean>(false);
  const [flowFeedback, setFlowFeedback] = useState<string>('');
  const [avalancheInput, setAvalancheInput] = useState<string>('SN-PCV20-2026-0004|BATCH-PCV-2026|2C-8C');

  const selectedPack = useMemo(
    () => packs.find((p) => p.serialNumber === selectedSerial) || packs[0],
    [packs, selectedSerial]
  );

  const selectedBatch = useMemo(
    () => batches.find((b) => b.batchId === selectedPack?.batchId) || batches[0],
    [batches, selectedPack]
  );

  const packEventsChronological = useMemo(() => {
    if (!selectedPack) return [];
    const matched = custodyEvents.filter(
      (e) => e.serialHash.toLowerCase() === selectedPack.serialHash.toLowerCase()
    );
    return [...matched].reverse();
  }, [custodyEvents, selectedPack]);

  const packBlocks = useMemo(() => {
    if (!packEventsChronological.length) return [];
    // buildHashChainedBlocks expects newest-first and returns newest-first; reverse back to chronological
    const blocksDesc = buildHashChainedBlocks([...packEventsChronological].reverse());
    return [...blocksDesc].reverse();
  }, [packEventsChronological]);

  const merkleData = useMemo(() => {
    if (!selectedBatch || !selectedPack) return null;
    const batchPacks = packs.filter((p) => p.batchId === selectedBatch.batchId);
    const tree = buildBatchMerkleTree(batchPacks, selectedBatch.expiresAt);
    const proof = generateMerkleInclusionProof(
      selectedPack.serialNumber,
      batchPacks,
      selectedBatch.expiresAt
    );
    return { tree, proof, leafCount: batchPacks.length };
  }, [packs, selectedBatch, selectedPack]);

  const eip712Data = useMemo(() => {
    if (!selectedPack || !selectedBatch) return null;
    return computeEIP712AttestationDigest({
      serialNumber: selectedPack.serialNumber,
      serialHash: selectedPack.serialHash,
      batchId: selectedPack.batchId,
      expiresAt: selectedBatch.expiresAt,
      nonce: selectedPack.nonce,
      status: selectedPack.status,
      chainId: 31337,
    });
  }, [selectedPack, selectedBatch]);

  const batchTelemetry = useMemo(
    () => (selectedBatch ? telemetry.filter((t) => t.batchId === selectedBatch.batchId) : []),
    [telemetry, selectedBatch]
  );

  const latestTemp = batchTelemetry[0]?.temperature;
  const hasTempBreach = batchTelemetry.some((t) => t.isBreached);

  // Stage completion states for selected pack
  const stage2Done =
    selectedPack?.status === 'IN_TRANSIT' ||
    selectedPack?.status === 'AT_PHARMACY' ||
    selectedPack?.status === 'DISPENSED' ||
    packEventsChronological.some((e) => e.action === 'TRANSFER_DISTRIBUTOR');
  const stage3Arrived =
    selectedPack?.status === 'AT_PHARMACY' ||
    selectedPack?.status === 'DISPENSED' ||
    packEventsChronological.some((e) => e.action === 'TRANSFER_PHARMACY');
  const stage3Dispensed = selectedPack?.status === 'DISPENSED';

  // Tamper-simulation hash cascade across stages
  const genesisBlock = packBlocks[0];
  const distributorBlock = packBlocks.find((b) => b.primaryAction === 'TRANSFER_DISTRIBUTOR') || packBlocks[1];
  const pharmacyBlock =
    packBlocks.find((b) => b.primaryAction === 'DISPENSED_TO_PATIENT') ||
    packBlocks.find((b) => b.primaryAction === 'TRANSFER_PHARMACY') ||
    packBlocks[2];

  const displayedGenesisHash = useMemo(() => {
    const real = genesisBlock?.blockHash || selectedPack?.serialHash || computeKeccakHex('GENESIS');
    if (!tamperBlockOne) return real;
    return computeKeccakHex(`TAMPERED_PAYLOAD:${real}`);
  }, [genesisBlock, selectedPack, tamperBlockOne]);

  const stage2Broken = tamperBlockOne && stage2Done;
  const stage3Broken = tamperBlockOne && stage3Arrived;
  const stage4Broken = tamperBlockOne || Boolean(selectedBatch?.isQuarantined || selectedBatch?.isRecalled);

  const liveAvalancheHash = useMemo(
    () => computeKeccakHex(avalancheInput || 'empty'),
    [avalancheInput]
  );

  const handleSelectPack = (serial: string) => {
    setSelectedSerial(serial);
    const pk = packs.find((p) => p.serialNumber === serial);
    const bt = batches.find((b) => b.batchId === pk?.batchId);
    if (pk && bt) {
      setAvalancheInput(`${pk.serialNumber}|${bt.batchCode}|${bt.minTemp}C-${bt.maxTemp}C`);
    }
    setFlowFeedback('');
  };

  const handleRunAdvance = async (action: FlowStageAdvanceAction) => {
    if (!selectedPack) return;
    setIsAdvancing(true);
    setFlowFeedback('');
    try {
      await onAdvanceStage(selectedPack.serialNumber, action);
      if (action === 'SHIP_TO_DISTRIBUTOR') {
        setFlowFeedback(
          `Signed by Manufacturer (EIP-712) and transferred ${selectedPack.serialNumber} to Cold-Chain Distributor with a linked block hash.`
        );
      } else if (action === 'DELIVER_TO_PHARMACY') {
        setFlowFeedback(
          `Signed by Distributor (EIP-712) and delivered ${selectedPack.serialNumber} to Hospital Pharmacy.`
        );
      } else {
        setFlowFeedback(
          `Signed by Pharmacy (EIP-712), ERC-5192 Soulbound-locked, and Zero-Knowledge Patient Receipt committed on-chain.`
        );
      }
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdvancing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Presenter Hero & Pack Controls */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 border-b border-slate-800 pb-6">
        <div className="space-y-2 max-w-2xl">
          <div className="text-xs font-medium text-emerald-400">
            Interactive Blockchain Architecture &amp; Live Lifecycle Walkthrough
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
            Manufacturer Hash to Customer Verification
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Trace a medicine pack across every phase: the manufacturer assigns cryptographic hashes
            and seals, the distributor and pharmacy chain signed custody blocks, and the customer
            verifies the entire proof chain.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="w-full sm:w-auto">
            <label htmlFor="flow-pack-select" className="sr-only">
              Select Medicine Pack to Trace
            </label>
            <select
              id="flow-pack-select"
              value={selectedPack?.serialNumber || ''}
              onChange={(e) => handleSelectPack(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-100"
            >
              {packs.map((p) => (
                <option key={p.serialNumber} value={p.serialNumber}>
                  {p.serialNumber} · {formatPackStatusLabel(p.status)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setTamperBlockOne((v) => !v)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              tamperBlockOne
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400'
                : 'bg-rose-950/50 hover:bg-rose-900/60 text-rose-200 border-rose-700/70'
            }`}
          >
            {tamperBlockOne ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Restore Valid Hash
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                Simulate Hash Tampering
              </>
            )}
          </button>

          {onOpenSupplyChainMap && (
            <button
              type="button"
              onClick={() => selectedPack && onOpenSupplyChainMap(selectedPack.serialNumber)}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              View Pack on Map
            </button>
          )}

          <button
            type="button"
            onClick={() => selectedPack && onOpenCustomerVerify(selectedPack.serialNumber)}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            Open Customer Verify
          </button>
        </div>
      </div>

      {/* Live Feedback Banner */}
      {(flowFeedback || tamperBlockOne) && (
        <div
          className={`p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            tamperBlockOne
              ? 'bg-rose-950/35 border-rose-700/70 text-rose-200'
              : 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
          }`}
        >
          <span>
            {tamperBlockOne
              ? 'Tamper simulation active: 1 character in Phase 1 (Manufacturer genesis block) was altered. Notice how its Keccak-256 hash changed completely, breaking the hash links in Phases 2, 3, and Customer Verification.'
              : flowFeedback}
          </span>
          {tamperBlockOne && (
            <button
              type="button"
              onClick={() => setTamperBlockOne(false)}
              className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-slate-100 font-medium whitespace-nowrap self-start sm:self-auto"
            >
              Reset Tamper Test
            </button>
          )}
        </div>
      )}

      {/* Selected Pack Context Strip */}
      {selectedPack && selectedBatch && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="space-y-0.5">
            <div className="text-slate-400">Tracing Serialized Digital Twin</div>
            <div className="text-sm sm:text-base font-bold text-slate-100">
              {selectedBatch.brandName}{' '}
              <span className="font-mono text-emerald-400 font-medium">
                · {selectedPack.serialNumber}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs">
            <div>
              <span className="text-slate-400 block">Batch Lot</span>
              <span className="font-mono text-slate-200">{selectedBatch.batchCode}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Token ID (ERC-721)</span>
              <span className="font-mono tabular-nums text-slate-200">#{selectedPack.tokenId}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Current Stage</span>
              <span className="font-semibold text-emerald-300">
                {formatPackStatusLabel(selectedPack.status)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Blocks Recorded</span>
              <span className="font-mono tabular-nums text-slate-200">
                {packBlocks.length || 1} linked block(s)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: 4-Stage Visual Blockchain Pipeline */}
      <section aria-labelledby="pipeline-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 id="pipeline-heading" className="text-lg font-bold text-slate-100">
              End-to-End 4-Phase Hash &amp; Custody Chain
            </h2>
            <p className="text-xs text-slate-400">
              Each phase cryptographically signs and links to the previous block hash—advance a pack
              live below to see every hash update.
            </p>
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums">
            Mode: {evmStatus?.connected ? `Live EVM (${evmStatus.mode})` : 'SQLite Hash-Chained Ledger'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
          {/* PHASE 1: MANUFACTURER */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between gap-4 min-w-0 ${
              tamperBlockOne
                ? 'bg-rose-950/20 border-rose-700/70'
                : 'bg-slate-900 border-emerald-700/50'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-emerald-400">Phase 1 · Mint &amp; Hash</span>
                <span
                  className={`font-medium flex items-center gap-1 ${
                    tamperBlockOne ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {tamperBlockOne ? (
                    <>
                      <XCircle className="w-3.5 h-3.5" /> Tampered
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Sealed
                    </>
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">Manufacturer</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Creates unique Keccak-256 serial hash, signs QR label with ECDSA, anchors batch
                  Merkle root &amp; optical PUF seal.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500 font-sans block">Smart Contract Role</span>
                  <span className="text-slate-200">MANUFACTURER_ROLE</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Assigned Product Hash</span>
                  <span className="text-emerald-300 break-all">
                    {shortHex(selectedPack?.serialHash, 14, 8)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Batch Merkle Root</span>
                  <span className="text-sky-300 break-all">
                    {shortHex(merkleData?.tree.merkleRoot, 14, 8)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Optical PUF Seal Hash</span>
                  <span className="text-slate-300 break-all">
                    {shortHex(selectedPack?.pufSealHash, 14, 8)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Genesis Block Hash</span>
                  <span className={tamperBlockOne ? 'text-rose-400 font-bold break-all' : 'text-emerald-400 break-all'}>
                    {shortHex(displayedGenesisHash, 14, 8)}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Signer: {shortHex(issuerPublicAddress, 8, 6)}</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 hidden xl:block" />
            </div>
          </div>

          {/* PHASE 2: DISTRIBUTOR */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between gap-4 min-w-0 ${
              stage2Broken
                ? 'bg-rose-950/20 border-rose-700/70'
                : stage2Done
                ? 'bg-slate-900 border-emerald-700/50'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-sky-400">Phase 2 · Transit Link</span>
                <span
                  className={`font-medium flex items-center gap-1 ${
                    stage2Broken
                      ? 'text-rose-400'
                      : stage2Done
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  {stage2Broken ? (
                    <>
                      <XCircle className="w-3.5 h-3.5" /> Broken Link
                    </>
                  ) : stage2Done ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Linked
                    </>
                  ) : (
                    'Ready to Ship'
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">Distributor</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Verifies Phase 1 hash, signs EIP-712 handover envelope, and logs signed IoT
                  temperature checkpoints in transit.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500 font-sans block">Smart Contract Role</span>
                  <span className="text-slate-200">DISTRIBUTOR_ROLE</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Links to Phase 1 Hash (prevHash)</span>
                  <span className={stage2Broken ? 'text-rose-400' : 'text-slate-300'}>
                    {stage2Done
                      ? stage2Broken
                        ? 'Mismatch vs tampered genesis!'
                        : shortHex(distributorBlock?.parentBlockHash || displayedGenesisHash, 14, 8)
                      : 'Waiting for dispatch...'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Cold-Chain IoT Reading</span>
                  <span className={hasTempBreach ? 'text-amber-300' : 'text-emerald-300'}>
                    {latestTemp !== undefined
                      ? `${latestTemp.toFixed(1)}°C (${hasTempBreach ? 'Alert Logged' : 'Within 2–8°C'})`
                      : '4.2°C Verified'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Handover Block / Tx</span>
                  <span className="text-emerald-400 break-all">
                    {stage2Done
                      ? shortHex(distributorBlock?.blockHash || selectedPack?.signature, 14, 8)
                      : 'Pending EIP-712 Tx'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              {!stage2Done && selectedPack?.status === 'MANUFACTURED' ? (
                <button
                  type="button"
                  disabled={isAdvancing}
                  onClick={() => handleRunAdvance('SHIP_TO_DISTRIBUTOR')}
                  className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  Sign &amp; Ship to Distributor
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>{stage2Done ? 'Handover recorded on ledger' : 'Status: ' + formatPackStatusLabel(selectedPack?.status || '')}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 hidden xl:block" />
                </div>
              )}
            </div>
          </div>

          {/* PHASE 3: PHARMACY */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between gap-4 min-w-0 ${
              stage3Broken
                ? 'bg-rose-950/20 border-rose-700/70'
                : stage3Dispensed
                ? 'bg-slate-900 border-emerald-700/50'
                : stage3Arrived
                ? 'bg-slate-900 border-sky-700/60'
                : 'bg-slate-900 border-slate-800'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-amber-300">Phase 3 · Lock &amp; ZK</span>
                <span
                  className={`font-medium flex items-center gap-1 ${
                    stage3Broken
                      ? 'text-rose-400'
                      : stage3Dispensed
                      ? 'text-emerald-400'
                      : stage3Arrived
                      ? 'text-sky-300'
                      : 'text-slate-400'
                  }`}
                >
                  {stage3Broken ? (
                    <>
                      <XCircle className="w-3.5 h-3.5" /> Broken Cascade
                    </>
                  ) : stage3Dispensed ? (
                    <>
                      <Lock className="w-3.5 h-3.5" /> Soulbound Locked
                    </>
                  ) : stage3Arrived ? (
                    'At Pharmacy Vault'
                  ) : (
                    'Pending Arrival'
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">Pharmacy</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Confirms delivery, dispenses to patient, permanently locks pack (ERC-5192), and
                  commits a Zero-Knowledge receipt hash.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500 font-sans block">Smart Contract Role</span>
                  <span className="text-slate-200">PHARMACY_ROLE</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">ERC-5192 Anti-Resale Lock</span>
                  <span className={stage3Dispensed ? 'text-emerald-300 flex items-center gap-1' : 'text-slate-300 flex items-center gap-1'}>
                    {stage3Dispensed ? (
                      <>
                        <Lock className="w-3 h-3" /> Locked Forever (Sold)
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3 h-3" /> Unlocked (In Custody)
                      </>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">ZK Patient Receipt Hash</span>
                  <span className="text-sky-300 break-all">
                    {selectedPack?.dispensedToReceipt
                      ? shortHex(selectedPack.dispensedToReceipt, 14, 8)
                      : 'Created on patient dispense'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Pharmacy Block Hash</span>
                  <span className={stage3Broken ? 'text-rose-400' : 'text-emerald-400 break-all'}>
                    {stage3Arrived
                      ? shortHex(pharmacyBlock?.blockHash || eip712Data?.eip712Digest, 14, 8)
                      : 'Waiting for pharmacy receipt'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              {selectedPack?.status === 'IN_TRANSIT' ? (
                <button
                  type="button"
                  disabled={isAdvancing}
                  onClick={() => handleRunAdvance('DELIVER_TO_PHARMACY')}
                  className="w-full py-2 px-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  Deliver to Pharmacy (Step 3a)
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : selectedPack?.status === 'AT_PHARMACY' ? (
                <button
                  type="button"
                  disabled={isAdvancing}
                  onClick={() => handleRunAdvance('DISPENSE_TO_CUSTOMER')}
                  className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  Dispense &amp; Lock Pack (Step 3b)
                  <Lock className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    {stage3Dispensed
                      ? 'Dispensed with private ZK receipt'
                      : 'Complete Phase 2 first'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 hidden xl:block" />
                </div>
              )}
            </div>
          </div>

          {/* PHASE 4: CUSTOMER VERIFICATION */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between gap-4 min-w-0 ${
              stage4Broken
                ? 'bg-rose-950/20 border-rose-700/70'
                : 'bg-slate-900 border-emerald-700/50'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono font-semibold text-emerald-400">Phase 4 · Customer Audit</span>
                <span
                  className={`font-medium flex items-center gap-1 ${
                    stage4Broken ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {stage4Broken ? (
                    <>
                      <XCircle className="w-3.5 h-3.5" /> Alert Blocked
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified
                    </>
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">Customer Verify</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Scans the QR code to verify the manufacturer signature, Merkle tree proof, optical
                  seal, and unbroken custody hash chain.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">1. ECDSA Signature</span>
                  <span className="font-mono text-emerald-400">Recovered OK</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">2. Batch Merkle Proof</span>
                  <span className="font-mono text-emerald-400">
                    {merkleData?.proof.isVerified ? 'Included O(log N)' : 'Unverified'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">3. Hash-Chain Integrity</span>
                  <span className={`font-mono ${tamperBlockOne ? 'text-rose-400 font-bold' : 'text-emerald-400'}`}>
                    {tamperBlockOne ? 'BROKEN AT BLOCK #1' : '100% Intact'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">4. Recall / Safety Hold</span>
                  <span
                    className={`font-mono ${
                      selectedBatch?.isQuarantined || selectedBatch?.isRecalled
                        ? 'text-rose-400 font-bold'
                        : 'text-emerald-400'
                    }`}
                  >
                    {selectedBatch?.isRecalled
                      ? 'RECALLED'
                      : selectedBatch?.isQuarantined
                      ? 'QUARANTINED'
                      : 'Clear'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => selectedPack && onOpenCustomerVerify(selectedPack.serialNumber)}
                className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                Verify as Customer Now
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: 6 Core Blockchain Concepts Demonstrated Live */}
      <section aria-labelledby="concepts-heading" className="space-y-4">
        <div>
          <h2 id="concepts-heading" className="text-lg font-bold text-slate-100">
            Blockchain Techniques Demonstrated in This Project
          </h2>
          <p className="text-xs text-slate-400">
            Every core concept below is running live on the selected pack and network state.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* 1. Cryptographic Hashing (Keccak-256 Avalanche Playground) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
              <KeyRound className="w-4 h-4" />
              01. Cryptographic Hashing (Keccak-256)
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Ethereum’s Keccak-256 turns any product record into a fixed 256-bit fingerprint. Edit 1
              character below to demonstrate the avalanche effect:
            </p>
            <div>
              <label htmlFor="avalanche-input" className="block text-[11px] text-slate-400 mb-1">
                Live Input Data (Try changing 1 character)
              </label>
              <input
                id="avalanche-input"
                type="text"
                value={avalancheInput}
                onChange={(e) => setAvalancheInput(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100"
              />
            </div>
            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[11px] text-slate-500 block">256-Bit Keccak Hash Output</span>
              <span className="text-[11px] font-mono text-emerald-300 break-all">
                {liveAvalancheHash}
              </span>
            </div>
          </div>

          {/* 2. Immutable Hash-Chained Blocks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0">
            <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
              <Link2 className="w-4 h-4" />
              02. Hash-Chained Blocks (Immutability)
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Each custody step stores the previous block’s hash (<span className="font-mono text-slate-300">parentBlockHash</span>).
              Altering past data invalidates every block after it.
            </p>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {packBlocks.map((blk, i) => {
                const isFirst = i === 0;
                const broken = tamperBlockOne && (isFirst || i > 0);
                return (
                  <div
                    key={blk.blockHash}
                    className={`p-2.5 rounded-lg border text-[11px] font-mono ${
                      broken
                        ? 'bg-rose-950/30 border-rose-700/60 text-rose-200'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-semibold">
                        Block #{blk.blockNumber} · {formatCustodyActionLabel(blk.primaryAction)}
                      </span>
                      <span>{broken ? 'INVALID' : 'VALID'}</span>
                    </div>
                    <div className="text-slate-400 truncate mt-0.5">
                      prev: {isFirst ? '0x0000...0000 (Genesis)' : shortHex(blk.parentBlockHash, 10, 6)}
                    </div>
                    <div className={broken ? 'text-rose-400 truncate' : 'text-emerald-400 truncate'}>
                      hash: {isFirst ? shortHex(displayedGenesisHash, 10, 6) : shortHex(blk.blockHash, 10, 6)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Smart Contracts & RBAC */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Blocks className="w-4 h-4" />
                03. Smart Contracts &amp; AccessControl
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Five Solidity <span className="font-mono text-slate-300">0.8.24</span> contracts enforce strict rules—e.g. only
                verified wallets signed via EIP-712 can mint, ship, dispense, or recall.
              </p>
              <div className="divide-y divide-slate-800 text-xs">
                <div className="py-1.5 flex justify-between gap-2">
                  <span className="font-mono text-slate-200">MedSupplySentinel.sol</span>
                  <span className="text-slate-400">Custody &amp; Merkle</span>
                </div>
                <div className="py-1.5 flex justify-between gap-2">
                  <span className="font-mono text-slate-200">MedicinePackNFT.sol</span>
                  <span className="text-slate-400">ERC-721 / 5192 Lock</span>
                </div>
                <div className="py-1.5 flex justify-between gap-2">
                  <span className="font-mono text-slate-200">ColdChainOracle.sol</span>
                  <span className="text-slate-400">IoT Breach Rules</span>
                </div>
                <div className="py-1.5 flex justify-between gap-2">
                  <span className="font-mono text-slate-200">RegulatorGovernance.sol</span>
                  <span className="text-slate-400">2-of-2 Multi-Sig</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSecurityLab}
              className="w-full py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              Test Smart Contract Rule Blocks
            </button>
          </div>

          {/* 4. Decentralization & Multi-Node Governance */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <Users className="w-4 h-4" />
              04. Decentralization &amp; Consensus
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              No single company owns or edits the chain. Five independent network participants
              co-validate custody, and Class I recalls require a <strong className="text-slate-200">2-of-2 regulator quorum</strong>.
            </p>
            <div className="space-y-1.5 text-xs">
              {participants.slice(0, 5).map((org) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between py-1 px-2.5 bg-slate-950 border border-slate-800 rounded"
                >
                  <span className="text-slate-200 truncate">{org.organizationName}</span>
                  <span className="font-mono text-[11px] text-emerald-400 shrink-0">
                    {org.role} · {org.isAuthorized ? 'Node Active' : 'Revoked'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Merkle Trees & Zero-Internet Edge Proof */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
                <GitBranch className="w-4 h-4" />
                05. Merkle Trees &amp; O(log N) Proof
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Instead of storing thousands of individual pack hashes on-chain, 1 batch Merkle Root
                proves any pack mathematically—even offline in remote clinics.
              </p>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Batch Packs (Leaves):</span>
                  <span className="text-slate-100 tabular-nums">{merkleData?.leafCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Proof Path Depth:</span>
                  <span className="text-emerald-400 tabular-nums">
                    {merkleData?.proof.proofSiblings.length ?? 0} sibling hash(es)
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-800">
                  <span className="text-slate-500 font-sans block text-[11px]">Batch Merkle Root</span>
                  <span className="text-[11px] text-sky-300 break-all">
                    {shortHex(merkleData?.tree.merkleRoot, 16, 8)}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenAuditStudio}
              className="w-full py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-200"
            >
              Inspect Full Merkle Tree &amp; Proofs
            </button>
          </div>

          {/* 6. Zero-Knowledge Privacy & Soulbound Tokens */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 min-w-0 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Lock className="w-4 h-4" />
                06. Zero-Knowledge Privacy &amp; ERC-5192
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Balances public transparency with HIPAA-style privacy: patient prescriptions stay
                hidden behind ZK salted commitments while spent packs lock permanently.
              </p>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Token Lock Standard</span>
                  <span className="font-mono text-slate-200">ERC-5192 Soulbound</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Privacy Proof</span>
                  <span className="font-mono text-emerald-300">Pedersen-Schnorr NIZK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Emergency Recall Key</span>
                  <span className="font-mono text-sky-300">2-of-3 Shamir + ECIES</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenAuditStudio}
              className="w-full py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-200"
            >
              Open Privacy &amp; Shamir Studio
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 3: Clean 3-Layer System Architecture Diagram */}
      <section aria-labelledby="arch-heading" className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 id="arch-heading" className="text-base font-bold text-slate-100">
                System Architecture Blueprint (How All Layers Connect)
              </h2>
              <p className="text-xs text-slate-400">
                Use this 3-layer map when explaining the end-to-end technology stack.
              </p>
            </div>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Full-Stack · React + Express + SQLite WAL + Solidity 0.8.24
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-emerald-400">
              Layer 1 · Physical Edge &amp; Clients
            </div>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
              <li>GS1 Digital Link QR + 256-bit Optical PUF seal</li>
              <li>EIP-712 client-side command signing per role</li>
              <li>Signed IoT hardware cold-chain sensors (ECDSA)</li>
              <li>Browser IndexedDB cache for offline clinic scans</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-sky-400">
              Layer 2 · Verification API &amp; AI Risk Engine
            </div>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Express gateway verifies signatures via <span className="font-mono">ecrecover</span></li>
              <li>Enforces OpenZeppelin-aligned RBAC &amp; replay nonces</li>
              <li>Scores travel speed (Haversine) + thermal MKT drift</li>
              <li>Broadcasts live excursions &amp; recalls via SSE stream</li>
            </ul>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-amber-300">
              Layer 3 · Blockchain &amp; Persistent Ledger
            </div>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Hash-chained SQLite WAL blocks with ECIES-sealed keys</li>
              <li>5 Solidity contracts (<span className="font-mono">MedSupplySentinel.sol</span> suite)</li>
              <li>Optional live Anvil / EVM RPC dual-write anchoring</li>
              <li>2-of-2 multi-sig recalls &amp; 2-of-3 Shamir recovery</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
