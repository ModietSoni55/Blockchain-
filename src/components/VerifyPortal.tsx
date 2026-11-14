import React, { useState } from 'react';
import {
  QrCode,
  AlertTriangle,
  Cpu,
  CheckCircle2,
  XCircle,
  Search,
  Flag,
  Copy,
  Navigation,
  Camera,
  Link2,
  WifiOff,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import {
  BatchRecord,
  PatientAdverseReport,
  VerificationResult,
  PUFMatchResult,
  generateMerkleInclusionProof,
  computeEIP712AttestationDigest,
  buildGS1DigitalLink,
} from '../utils/sentinelLogic';
import {
  formatActorDisplayName,
  formatCustodyActionLabel,
  formatPackStatusLabel,
  formatRiskFeatureLabel,
  formatSignatureMethodLabel,
  formatVerdictHeadline,
} from '../utils/uiLabels';
import { OfflineVaultSnapshot, QueuedOfflineScan } from '../utils/offlineVault';
import { QRCodeMatrix } from './QRCodeMatrix';

export interface ScanCheckpointOption {
  key: string;
  label: string;
}

interface VerifyPortalProps {
  scanSerialInput: string;
  onScanSerialInputChange: (val: string) => void;
  scanCheckpointKey: string;
  checkpoints: ScanCheckpointOption[];
  onSelectCheckpoint: (key: string) => void;
  onUseBrowserGPS: () => void;
  onOpenScannerModal: () => void;
  onVerify: (rawInput: string, simulateGeoCloneJump?: boolean, simulatePufClone?: boolean) => void;
  onTestTamperedQR: () => void;
  scanNotification: string;
  copiedQrMsg: string;
  activeVerification: VerificationResult;
  activePackCryptoProof: {
    merkleProof: ReturnType<typeof generateMerkleInclusionProof>;
    eip712: ReturnType<typeof computeEIP712AttestationDigest>;
  } | null;
  lastPufCheck: PUFMatchResult | null;
  jumpSummaryText: string;
  onLoadGS1DigitalLink: () => void;
  onCopySignedQRPayload: () => void;
  offlineVault: OfflineVaultSnapshot | null;
  simulatedOfflineMode: boolean;
  onToggleOfflineMode: () => void;
  onSyncOfflineVault: () => void;
  queuedOfflineScans: QueuedOfflineScan[];
  onFlushQueuedOfflineScans: () => void;
  lastVerifyMeta: {
    signatureMethod: string;
    inferenceEngine: string;
    verifiedOffline: boolean;
  };
  reportCategory: PatientAdverseReport['issueCategory'];
  onReportCategoryChange: (val: PatientAdverseReport['issueCategory']) => void;
  reportLocationCity: string;
  onReportLocationCityChange: (val: string) => void;
  reportNotes: string;
  onReportNotesChange: (val: string) => void;
  reportSubmittedMsg: string;
  onSubmitReport: (e: React.FormEvent) => void;
  batches: BatchRecord[];
}

export const VerifyPortal: React.FC<VerifyPortalProps> = ({
  scanSerialInput,
  onScanSerialInputChange,
  scanCheckpointKey,
  checkpoints,
  onSelectCheckpoint,
  onUseBrowserGPS,
  onOpenScannerModal,
  onVerify,
  onTestTamperedQR,
  scanNotification,
  copiedQrMsg,
  activeVerification,
  activePackCryptoProof,
  lastPufCheck,
  jumpSummaryText,
  onLoadGS1DigitalLink,
  onCopySignedQRPayload,
  offlineVault,
  simulatedOfflineMode,
  onToggleOfflineMode,
  onSyncOfflineVault,
  queuedOfflineScans,
  onFlushQueuedOfflineScans,
  lastVerifyMeta,
  reportCategory,
  onReportCategoryChange,
  reportLocationCity,
  onReportLocationCityChange,
  reportNotes,
  onReportNotesChange,
  reportSubmittedMsg,
  onSubmitReport,
}) => {
  const [showTechnicalProof, setShowTechnicalProof] = useState<boolean>(false);
  const [showOfflineControls, setShowOfflineControls] = useState<boolean>(false);

  const verdict = formatVerdictHeadline(activeVerification.outcome);
  const isSafe = verdict.tone === 'safe';
  const isWarn = verdict.tone === 'warn';

  const riskScore = Math.min(100, Math.max(0, activeVerification.aiAssessment.riskScore));
  const riskLabel =
    activeVerification.aiAssessment.riskLevel === 'LOW'
      ? 'Low Risk'
      : activeVerification.aiAssessment.riskLevel === 'MEDIUM'
      ? 'Moderate Risk'
      : 'High Risk';

  return (
    <div className="space-y-7">
      {/* Page Intro — Clean & Uncluttered */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
            Verify Medicine Authenticity
          </h1>
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
            Scan a QR code or enter a medicine pack serial number to verify manufacturer origin,
            cold storage safety, and tamper protection.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowOfflineControls((v) => !v)}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex items-center gap-2 self-start md:self-auto whitespace-nowrap"
        >
          <WifiOff className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            {simulatedOfflineMode ? 'Offline Mode Active' : 'Offline Verification Ready'}
          </span>
          {showOfflineControls ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>
      </div>

      {/* Main Scan Bar & Compact Sample Scenarios */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onVerify(scanSerialInput, false);
          }}
          className="flex flex-col lg:flex-row gap-3"
        >
          <div className="relative flex-1">
            <label htmlFor="serial-search-input" className="sr-only">
              Medicine Pack Serial Number or QR Code
            </label>
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="serial-search-input"
              type="text"
              value={scanSerialInput}
              onChange={(e) => onScanSerialInputChange(e.target.value)}
              placeholder="Enter pack serial number (e.g. SN-PCV20-2026-0001) or paste QR data..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            <select
              aria-label="Scanner Location"
              value={scanCheckpointKey}
              onChange={(e) => onSelectCheckpoint(e.target.value)}
              className="w-full sm:w-auto sm:max-w-[230px] px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
            >
              {checkpoints.map((cp) => (
                <option key={cp.key} value={cp.key}>
                  {cp.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onUseBrowserGPS}
              title="Use your device GPS location"
              className="px-3 py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              My GPS
            </button>

            <button
              type="button"
              onClick={onOpenScannerModal}
              title="Scan a QR code using webcam or uploaded image"
              className="px-3 py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5 text-emerald-400" />
              Scan QR
            </button>

            <button
              type="submit"
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <QrCode className="w-4 h-4" />
              Verify Authenticity
            </button>
          </div>
        </form>

        {/* Quick Demo Scenarios Strip — Secondary Weight */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium mr-1">Try a sample case:</span>
          <button
            type="button"
            onClick={() => onVerify('SN-PCV20-2026-0001', false)}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-emerald-300 border border-slate-800 transition-colors"
          >
            Authentic Pack
          </button>
          <button
            type="button"
            onClick={() => onVerify('SN-PCV20-2026-0002', false)}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-amber-300 border border-slate-800 transition-colors"
          >
            Duplicate Scan Warning
          </button>
          <button
            type="button"
            onClick={() => onVerify('SN-PCV20-2026-0001', true)}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-sky-300 border border-slate-800 transition-colors"
          >
            Impossible Travel Speed
          </button>
          <button
            type="button"
            onClick={onTestTamperedQR}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-rose-300 border border-slate-800 transition-colors"
          >
            Forged Signature
          </button>
          <button
            type="button"
            onClick={() => onVerify('SN-PCV20-2026-0001', false, true)}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-rose-300 border border-slate-800 transition-colors"
          >
            Photocopy Clone
          </button>
          <button
            type="button"
            onClick={() => onVerify('SN-HUM-2026-0001', false)}
            className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-rose-300 border border-slate-800 transition-colors"
          >
            Quarantined Lot
          </button>
        </div>

        {/* Collapsible Offline Verification Controls */}
        {showOfflineControls && (
          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-slate-300">
              <span className="font-semibold text-slate-100">Offline Field Verification: </span>
              {offlineVault
                ? `${Object.keys(offlineVault.merkleRootsByBatchId).length} medicine batches cached locally for areas without internet.`
                : 'Syncing local safety snapshot...'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSyncOfflineVault}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md text-slate-200 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3 text-emerald-400" />
                Refresh Offline Cache
              </button>
              <button
                type="button"
                onClick={onToggleOfflineMode}
                className={`px-2.5 py-1.5 rounded-md border font-medium flex items-center gap-1.5 ${
                  simulatedOfflineMode
                    ? 'bg-amber-950/60 border-amber-600 text-amber-300'
                    : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <WifiOff className="w-3 h-3" />
                {simulatedOfflineMode ? 'Turn Off Offline Test' : 'Test Offline Mode'}
              </button>
              {queuedOfflineScans.length > 0 && (
                <button
                  type="button"
                  onClick={onFlushQueuedOfflineScans}
                  className="px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md"
                >
                  Upload {queuedOfflineScans.length} Pending Scan(s)
                </button>
              )}
            </div>
          </div>
        )}

        {(scanNotification || copiedQrMsg) && (
          <div className="text-xs text-emerald-300 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2">
            {copiedQrMsg || scanNotification}
          </div>
        )}
      </div>

      {/* Main Split Grid: Verification Result + Journey (Left) | Safety Score + Report (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          {/* Plain-English Verdict Card */}
          <div
            className={`rounded-xl border p-6 ${
              isSafe
                ? 'bg-emerald-950/25 border-emerald-700/60'
                : isWarn
                ? 'bg-amber-950/25 border-amber-700/60'
                : 'bg-rose-950/25 border-rose-700/60'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5">
              <div className="flex items-start gap-3.5">
                {isSafe ? (
                  <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />
                ) : isWarn ? (
                  <AlertTriangle className="w-7 h-7 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-7 h-7 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <span
                    className={`inline-block text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
                      isSafe
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : isWarn
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {verdict.badge}
                  </span>
                  <h2 className="mt-2 text-xl font-bold text-slate-100">{verdict.title}</h2>
                  <p className="mt-1.5 text-sm text-slate-200 leading-relaxed">
                    {activeVerification.message}
                  </p>
                  {jumpSummaryText && (
                    <p className="mt-2 text-xs text-amber-300 bg-slate-950/60 border border-amber-800/40 rounded px-2.5 py-1.5">
                      {jumpSummaryText}
                    </p>
                  )}
                </div>
              </div>

              {activeVerification.pack && activeVerification.batch && (
                <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  <QRCodeMatrix
                    value={buildGS1DigitalLink(
                      activeVerification.batch.productCode,
                      activeVerification.pack.serialNumber,
                      activeVerification.pack.signature
                    )}
                    size={96}
                    label={activeVerification.pack.serialNumber}
                    allowDownload={true}
                  />
                  <div className="flex flex-col sm:flex-row gap-1.5">
                    <button
                      type="button"
                      onClick={onLoadGS1DigitalLink}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[11px] text-emerald-300 flex items-center gap-1"
                    >
                      <Link2 className="w-3 h-3" />
                      GS1 Link
                    </button>
                    <button
                      type="button"
                      onClick={onCopySignedQRPayload}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-300 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      Copy QR Data
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 4 Essential Human-Readable Facts */}
            {activeVerification.pack && activeVerification.batch && (
              <>
                <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg">
                    <span className="text-slate-400 block">Medicine &amp; Batch Lot</span>
                    <span className="font-semibold text-slate-100 text-sm mt-0.5 block">
                      {activeVerification.batch.brandName}
                    </span>
                    <span className="text-slate-400 font-mono mt-0.5 block">
                      {activeVerification.batch.batchCode} · {activeVerification.pack.serialNumber}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg">
                    <span className="text-slate-400 block">Current Holder</span>
                    <span className="font-semibold text-slate-100 text-sm mt-0.5 block">
                      {activeVerification.pack.currentCustodian}
                    </span>
                    <span className="text-emerald-300 mt-0.5 block">
                      Status: {formatPackStatusLabel(activeVerification.pack.status)}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg">
                    <span className="text-slate-400 block">Safe Storage Range</span>
                    <span className="font-semibold text-slate-100 text-sm mt-0.5 block tabular-nums">
                      {activeVerification.batch.minTemp.toFixed(1)}°C to{' '}
                      {activeVerification.batch.maxTemp.toFixed(1)}°C
                    </span>
                    <span className="text-slate-400 mt-0.5 block">
                      Expires {activeVerification.batch.expiresAt.slice(0, 10)}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg">
                    <span className="text-slate-400 block">Scan Activity</span>
                    <span className="font-semibold text-slate-100 text-sm mt-0.5 block tabular-nums">
                      {activeVerification.pack.scanCount} recorded scan(s)
                    </span>
                    <span className="text-slate-400 mt-0.5 block truncate">
                      Last check: {activeVerification.pack.lastScannedLocation || 'Manufacturing Plant'}
                    </span>
                  </div>
                </div>

                {/* Progressive Disclosure for Judges / Auditors */}
                <div className="mt-4 pt-3 border-t border-slate-800/60">
                  <button
                    type="button"
                    onClick={() => setShowTechnicalProof((v) => !v)}
                    className="w-full flex items-center justify-between text-xs font-medium text-slate-300 hover:text-slate-100 py-1"
                  >
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Technical Proof &amp; Blockchain Verification Details
                    </span>
                    {showTechnicalProof ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </button>

                  {showTechnicalProof && (
                    <div className="mt-3 p-4 bg-slate-950/90 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                      {activePackCryptoProof && (
                        <>
                          <div>
                            <span className="text-slate-400 block font-sans">
                              Batch Merkle Proof
                            </span>
                            <span className="text-emerald-300">
                              {activePackCryptoProof.merkleProof.isVerified
                                ? `Verified (${activePackCryptoProof.merkleProof.merkleRoot.slice(0, 12)}...)`
                                : 'Unverified'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-sans">
                              EIP-712 Signature Digest
                            </span>
                            <span className="text-slate-200">
                              {activePackCryptoProof.eip712.eip712Digest.slice(0, 16)}...
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block font-sans">
                              ERC-5192 Token Lock
                            </span>
                            <span className="text-slate-200">
                              {activePackCryptoProof.eip712.isSoulboundLocked
                                ? 'Locked (Terminal State)'
                                : 'Active Custody'}
                            </span>
                          </div>
                        </>
                      )}
                      <div>
                        <span className="text-slate-400 block font-sans">
                          Optical Anti-Photocopy Seal
                        </span>
                        <span
                          className={
                            lastPufCheck && !lastPufCheck.isAuthentic
                              ? 'text-rose-400'
                              : 'text-emerald-300'
                          }
                        >
                          {lastPufCheck
                            ? `${lastPufCheck.similarityPct}% match (${lastPufCheck.bitDrift}/256 bit drift)`
                            : `Genuine · 256-bit PUF Matched`}
                        </span>
                      </div>
                      <div className="sm:col-span-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                        Verification method: {formatSignatureMethodLabel(lastVerifyMeta.signatureMethod)} ·{' '}
                        {lastVerifyMeta.verifiedOffline ? 'Offline Cache' : 'Live Ledger'}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Human-Readable Chain of Custody Timeline */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
              <div>
                <h3 className="text-base font-semibold text-slate-100">Medicine Journey History</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Every verified handover recorded from manufacturing to pharmacy
                </p>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">
                {activeVerification.custodyTimeline.length} step(s)
              </span>
            </div>

            {activeVerification.custodyTimeline.length === 0 ? (
              <p className="text-sm text-slate-400 py-4">
                No custody records exist for this serial number in the verified registry.
              </p>
            ) : (
              <div className="relative space-y-5">
                {activeVerification.custodyTimeline.map((evt, idx) => {
                  const isLast = idx === activeVerification.custodyTimeline.length - 1;
                  return (
                    <div
                      key={evt.id}
                      className="relative pl-10 flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                    >
                      {!isLast && (
                        <span
                          aria-hidden="true"
                          className="absolute left-[13px] top-7 bottom-[-20px] w-px bg-slate-800"
                        />
                      )}
                      <span className="absolute left-0 top-0.5 w-7 h-7 rounded-full bg-slate-950 border border-emerald-500/40 text-emerald-400 font-mono text-xs font-bold flex items-center justify-center tabular-nums">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="text-xs font-medium text-emerald-300">
                          {formatCustodyActionLabel(evt.action)}
                        </div>
                        <div className="text-sm font-semibold text-slate-100 mt-0.5">
                          {formatActorDisplayName(evt.fromActor)} → {formatActorDisplayName(evt.toActor)}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                          {evt.location} · {evt.notes}
                        </div>
                      </div>
                      <div className="text-left sm:text-right text-[11px] text-slate-400 shrink-0">
                        <div>{evt.timestamp.slice(0, 16).replace('T', ' ')} UTC</div>
                        <div className="font-mono text-slate-500 mt-0.5">
                          Ref: {evt.txHash.slice(0, 10)}...
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 Columns: Safety Risk Score + Report a Problem */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Safety Risk Assessment</h3>
                  <p className="text-xs text-slate-400">Automated counterfeit &amp; anomaly check</p>
                </div>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">
                {(activeVerification.aiAssessment.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 pb-5 border-b border-slate-800">
              <div className="flex items-center gap-4">
                {(() => {
                  const r = 28;
                  const circ = 2 * Math.PI * r;
                  const arcLen = circ * (240 / 360);
                  const fillLen = Math.max(riskScore > 0 ? 4 : 0, (riskScore / 100) * arcLen);
                  const strokeHex =
                    riskScore < 25 ? '#10b981' : riskScore < 60 ? '#f59e0b' : '#f43f5e';
                  return (
                    <svg
                      width="74"
                      height="74"
                      viewBox="0 0 74 74"
                      className="shrink-0"
                      aria-hidden="true"
                    >
                      <circle
                        cx="37"
                        cy="37"
                        r={r}
                        fill="none"
                        stroke="#1e293b"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${arcLen} ${circ}`}
                        transform="rotate(150 37 37)"
                      />
                      <circle
                        cx="37"
                        cy="37"
                        r={r}
                        fill="none"
                        stroke={strokeHex}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${fillLen} ${circ}`}
                        transform="rotate(150 37 37)"
                      />
                      <text
                        x="37"
                        y="40"
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="700"
                        fill="#f8fafc"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {riskScore.toFixed(0)}
                      </text>
                    </svg>
                  );
                })()}
                <div>
                  <span className="text-xs text-slate-400 block">Risk Score (0 = Safest)</span>
                  <span className="font-display text-2xl font-bold tabular-nums text-slate-100">
                    {activeVerification.aiAssessment.riskScore.toFixed(0)}
                    <span className="text-xs font-mono font-normal text-slate-400"> / 100</span>
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs text-slate-400 block">Assessment</span>
                <span
                  className={`text-sm font-bold ${
                    activeVerification.aiAssessment.riskLevel === 'LOW'
                      ? 'text-emerald-400'
                      : activeVerification.aiAssessment.riskLevel === 'MEDIUM'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {riskLabel}
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-slate-400">Why this rating was given</div>
                <p className="mt-1 text-slate-200 leading-relaxed">
                  {activeVerification.aiAssessment.reason}
                </p>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-400">What you should do</div>
                <p className="mt-1 font-medium text-emerald-300">
                  {activeVerification.aiAssessment.recommendedAction}
                </p>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-800">
              <div className="text-xs font-medium text-slate-400 mb-3">
                Key Factors Checked
              </div>
              <div className="space-y-2.5">
                {Object.entries(activeVerification.aiAssessment.featureImportance).map(
                  ([featureKey, weight]) => (
                    <div key={featureKey} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300">{formatRiskFeatureLabel(featureKey)}</span>
                        <span className="text-slate-400 font-mono tabular-nums">
                          {(weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${Math.round(weight * 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Patient & Pharmacist Incident Reporting */}
          <form
            onSubmit={onSubmitReport}
            className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Report Packaging or Safety Issue
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Notice a broken seal or suspicious label? Flag it directly to safety regulators.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="report-category"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Issue Type
                </label>
                <select
                  id="report-category"
                  value={reportCategory}
                  onChange={(e) =>
                    onReportCategoryChange(e.target.value as PatientAdverseReport['issueCategory'])
                  }
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  <option value="SUSPECTED_FAKE_LABEL">Suspected Counterfeit Label</option>
                  <option value="BROKEN_SEAL">Broken / Tampered Seal</option>
                  <option value="DISCOLORATION">Cloudy / Heat-Damaged Vial</option>
                  <option value="DUPLICATE_SERIAL_ALERT">Serial Number Already Used</option>
                </select>
              </div>
              <div>
                <label htmlFor="report-city" className="block text-xs font-medium text-slate-300 mb-1">
                  Pharmacy / Clinic Location
                </label>
                <input
                  id="report-city"
                  type="text"
                  value={reportLocationCity}
                  onChange={(e) => onReportLocationCityChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                />
              </div>
            </div>

            <div>
              <label htmlFor="report-notes" className="block text-xs font-medium text-slate-300 mb-1">
                What did you observe?
              </label>
              <input
                id="report-notes"
                type="text"
                value={reportNotes}
                onChange={(e) => onReportNotesChange(e.target.value)}
                placeholder="Describe any physical damage or label mismatch..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
              />
            </div>

            {reportSubmittedMsg && (
              <p className="text-xs text-emerald-400">{reportSubmittedMsg}</p>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-lg transition-colors"
            >
              Send Alert to Safety Regulators
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
