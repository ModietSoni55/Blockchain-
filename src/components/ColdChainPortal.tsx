import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  BatchRecord,
  LogisticsHubNode,
  TelemetryEvent,
  buildTelemetryHashChain,
} from '../utils/sentinelLogic';
import { ColdChainChart } from './ColdChainChart';

interface ColdChainPortalProps {
  batches: BatchRecord[];
  logisticsHubs: LogisticsHubNode[];
  telemetry: TelemetryEvent[];
  activeIoTBatch: BatchRecord;
  activeBatchTelemetry: TelemetryEvent[];
  activeBatchMKT: number;
  predictiveColdChain: {
    driftPerHour: number;
    projectedTemp2h: number;
    remainingShelfLifePct: number;
    isExcursionImminent: boolean;
    imminentWarning?: string;
    recommendation: string;
  };
  selectedBatchForIoT: string;
  onChangeSelectedBatchForIoT: (val: string) => void;
  selectedHubForIoT: string;
  onChangeSelectedHubForIoT: (hubId: string) => void;
  simTemperature: string;
  onChangeSimTemperature: (val: string) => void;
  simLocation: string;
  onChangeSimLocation: (val: string) => void;
  onRecordTelemetry: (overrideTemp?: number) => void;
  onSendHardwareSignedIoT: (replayPrevious?: boolean) => void;
  hasLastHardwarePacket: boolean;
  iotFeedback: string;
}

function shortHash(val: string | undefined, head = 10, tail = 6): string {
  if (!val) return '—';
  if (val.length <= head + tail + 3) return val;
  return `${val.slice(0, head)}...${val.slice(-tail)}`;
}

export const ColdChainPortal: React.FC<ColdChainPortalProps> = ({
  batches,
  logisticsHubs,
  telemetry,
  activeIoTBatch,
  activeBatchTelemetry,
  activeBatchMKT,
  predictiveColdChain,
  selectedBatchForIoT,
  onChangeSelectedBatchForIoT,
  selectedHubForIoT,
  onChangeSelectedHubForIoT,
  simTemperature,
  onChangeSimTemperature,
  simLocation,
  onChangeSimLocation,
  onRecordTelemetry,
  onSendHardwareSignedIoT,
  hasLastHardwarePacket,
  iotFeedback,
}) => {
  const [showHardwareTests, setShowHardwareTests] = useState<boolean>(false);
  const [tamperedBlockId, setTamperedBlockId] = useState<string | null>(null);

  const telemetryChain = useMemo(() => {
    if (!tamperedBlockId) return buildTelemetryHashChain(telemetry);
    const target = telemetry.find((t) => t.id === tamperedBlockId);
    const safeMidTemp = Number(((activeIoTBatch.minTemp + activeIoTBatch.maxTemp) / 2).toFixed(1));
    const fakeTemp = target?.isBreached
      ? safeMidTemp
      : Number(((target?.temperature ?? 4.5) + 6.5).toFixed(1));
    return buildTelemetryHashChain(telemetry, { id: tamperedBlockId, temperature: fakeTemp });
  }, [telemetry, tamperedBlockId, activeIoTBatch.minTemp, activeIoTBatch.maxTemp]);

  const activeBreaches = useMemo(
    () => activeBatchTelemetry.filter((t) => t.isBreached),
    [activeBatchTelemetry]
  );
  const latestActiveBreach = activeBreaches[0];

  const freezeTestTemp = Number((activeIoTBatch.minTemp - 3.5).toFixed(1));
  const overheatTestTemp = Number((activeIoTBatch.maxTemp + 6.8).toFixed(1));

  const handleToggleTamperSimulation = () => {
    if (tamperedBlockId) {
      setTamperedBlockId(null);
      return;
    }
    // Prefer picking a breached record or an older record so downstream cascade invalidation is clearly visible
    const preferred =
      telemetry.find((t) => t.isBreached) || telemetry[Math.min(2, Math.max(0, telemetry.length - 1))];
    if (preferred) {
      setTamperedBlockId(preferred.id);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Immutable Cold-Chain Blockchain &amp; Temperature Monitor
          </h1>
          <p className="mt-1 text-sm text-slate-400 max-w-3xl">
            Every refrigerator temperature reading is hashed into a linked Keccak-256 blockchain ledger
            with append-only database locks. Nobody can alter or erase historical storage records.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleTamperSimulation}
            disabled={telemetry.length === 0}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              tamperedBlockId
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400'
                : 'bg-rose-950/50 hover:bg-rose-900/60 text-rose-200 border-rose-700/70'
            }`}
          >
            {tamperedBlockId ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Restore Sealed Ledger
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                Simulate DB Temp Tampering
              </>
            )}
          </button>
        </div>
      </div>

      {/* Immutable Cold-Chain Blockchain Integrity Strip */}
      <div
        className={`rounded-xl border p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs ${
          telemetryChain.allValid
            ? 'bg-slate-900 border-emerald-700/50'
            : 'bg-rose-950/30 border-rose-700/80'
        }`}
      >
        <div className="flex items-start gap-3">
          {telemetryChain.allValid ? (
            <Lock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`font-semibold text-sm ${
                  telemetryChain.allValid ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {telemetryChain.allValid
                  ? `Cold-Chain Ledger Verified (${telemetryChain.totalBlocks} / ${telemetryChain.totalBlocks} Blocks Intact)`
                  : `TAMPER DETECTED AT BLOCK #${telemetryChain.firstBrokenBlockIndex} (${telemetryChain.brokenCount} Block(s) Invalidated)`}
              </span>
              <span className="text-slate-400 font-mono">
                · SQLite Append-Only Triggers Active (UPDATE/DELETE Blocked)
              </span>
            </div>
            <p className="text-slate-300 mt-1 leading-relaxed">
              {telemetryChain.allValid
                ? 'Every sensor temperature reading is sealed with Keccak-256 and chained to the prior block hash. Modifying any past temperature breaks the cryptographic seal.'
                : 'A stored temperature record was modified after sealing. Its Keccak-256 digest no longer matches the block hash, breaking verification for every subsequent block in the chain.'}
            </p>
          </div>
        </div>

        <div className="shrink-0 font-mono text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5">
          <span className="text-slate-400 font-sans block">Latest Sealed Head Hash</span>
          <span className={telemetryChain.allValid ? 'text-emerald-300' : 'text-rose-300'}>
            {shortHash(telemetryChain.latestBlockHash, 14, 10)}
          </span>
        </div>
      </div>

      {/* Active Batch Subcooling / Overheat Breach Alert */}
      {latestActiveBreach && (
        <div className="rounded-xl border border-rose-700/80 bg-rose-950/35 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-rose-200">
                {latestActiveBreach.breachType === 'SUBCOOLING'
                  ? `FREEZE / SUBCOOLING ALERT: ${activeIoTBatch.batchCode} dropped to ${latestActiveBreach.temperature.toFixed(1)}°C`
                  : `OVERHEAT ALERT: ${activeIoTBatch.batchCode} rose to ${latestActiveBreach.temperature.toFixed(1)}°C`}
              </div>
              <p className="text-rose-200/90 mt-1">
                Safe range is {activeIoTBatch.minTemp.toFixed(1)}°C – {activeIoTBatch.maxTemp.toFixed(1)}°C.
                Recorded at {latestActiveBreach.locationLabel} ({latestActiveBreach.deviceId}) and
                permanently sealed on Block #{latestActiveBreach.blockIndex ?? '—'}.
              </p>
            </div>
          </div>
          <div className="font-mono text-[11px] text-rose-300 bg-slate-950/80 border border-rose-800/60 rounded-lg px-3 py-2 shrink-0">
            Seal: {shortHash(latestActiveBreach.blockHash, 10, 8)}
          </div>
        </div>
      )}

      {/* Live Thermal Envelope Chart */}
      <ColdChainChart
        readings={activeBatchTelemetry}
        minTemp={activeIoTBatch.minTemp}
        maxTemp={activeIoTBatch.maxTemp}
        mktValue={activeBatchMKT}
      />

      {/* 4 Clear Health Summary Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            Temperature Trend
          </div>
          <div className="mt-1.5 text-xl font-bold font-mono text-slate-100 tabular-nums">
            {predictiveColdChain.driftPerHour >= 0 ? '+' : ''}
            {predictiveColdChain.driftPerHour.toFixed(2)} °C/hr
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Current rate of change</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400">2-Hour Forecast</div>
          <div
            className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${
              predictiveColdChain.isExcursionImminent ? 'text-amber-400' : 'text-slate-100'
            }`}
          >
            {predictiveColdChain.projectedTemp2h.toFixed(1)} °C
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Safe limit: {activeIoTBatch.minTemp.toFixed(1)}°C – {activeIoTBatch.maxTemp.toFixed(1)}°C
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400">Estimated Medicine Potency</div>
          <div
            className={`mt-1.5 text-xl font-bold font-mono tabular-nums ${
              predictiveColdChain.remainingShelfLifePct < 80 ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {predictiveColdChain.remainingShelfLifePct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Based on cumulative heat exposure</div>
        </div>

        <div
          className={`border rounded-xl p-4 text-xs ${
            predictiveColdChain.isExcursionImminent
              ? 'bg-amber-950/35 border-amber-700/60 text-amber-200'
              : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}
        >
          <div className="font-semibold text-slate-100">
            {predictiveColdChain.isExcursionImminent ? 'Early Warning Active' : 'Storage Advisory'}
          </div>
          <p className="mt-1 leading-relaxed">
            {predictiveColdChain.imminentWarning || predictiveColdChain.recommendation}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sensor Check-In Form */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Record Sensor Check-In</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Seal a new temperature reading onto the cold-chain blockchain, or trigger a live low/high alert.
            </p>
          </div>

          <div>
            <label htmlFor="iot-batch-select" className="block text-xs font-medium text-slate-300 mb-1">
              Medicine Batch
            </label>
            <select
              id="iot-batch-select"
              value={selectedBatchForIoT}
              onChange={(e) => onChangeSelectedBatchForIoT(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
            >
              {batches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batchCode} — {b.brandName} ({b.minTemp}°C to {b.maxTemp}°C)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="iot-hub-select" className="block text-xs font-medium text-slate-300 mb-1">
              Storage Facility / Checkpoint
            </label>
            <select
              id="iot-hub-select"
              value={selectedHubForIoT}
              onChange={(e) => onChangeSelectedHubForIoT(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
            >
              {logisticsHubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.cityState})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="iot-temp-input" className="block text-xs font-medium text-slate-300 mb-1">
                Measured Temp (°C)
              </label>
              <input
                id="iot-temp-input"
                type="number"
                step="0.1"
                value={simTemperature}
                onChange={(e) => onChangeSimTemperature(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono"
              />
            </div>
            <div>
              <label htmlFor="iot-loc-input" className="block text-xs font-medium text-slate-300 mb-1">
                Location Note
              </label>
              <input
                id="iot-loc-input"
                type="text"
                value={simLocation}
                onChange={(e) => onChangeSimLocation(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100"
              />
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={() => onRecordTelemetry()}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
            >
              Log &amp; Seal Reading on Blockchain
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onRecordTelemetry(freezeTestTemp)}
                className="py-2 px-3 bg-sky-950/70 hover:bg-sky-900/70 border border-sky-700/70 text-sky-200 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
              >
                Test {freezeTestTemp}°C Freeze Alert
              </button>
              <button
                type="button"
                onClick={() => onRecordTelemetry(overheatTestTemp)}
                className="py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
              >
                Test {overheatTestTemp}°C Overheat Alert
              </button>
            </div>
          </div>

          {/* Progressive Disclosure for Hardware Sensor Security Testing */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowHardwareTests((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 py-1"
            >
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Hardware Sensor Security Test (Signed Telemetry)
              </span>
              {showHardwareTests ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showHardwareTests && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onSendHardwareSignedIoT(false)}
                  className="flex-1 py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-emerald-300 text-xs rounded-lg"
                >
                  Send Signed Hardware Packet
                </button>
                {hasLastHardwarePacket && (
                  <button
                    type="button"
                    onClick={() => onSendHardwareSignedIoT(true)}
                    className="py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-amber-700/60 text-amber-300 text-xs rounded-lg"
                  >
                    Test Replay Attack Block
                  </button>
                )}
              </div>
            )}
          </div>

          {iotFeedback && (
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200">
              {iotFeedback}
            </div>
          )}
        </div>

        {/* Immutable Blockchain-Verified Sensor Feed Table */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Immutable Cold-Chain Sensor Ledger
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Each reading is cryptographically linked to the previous block so past temperatures cannot be altered.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
              {telemetryChain.totalBlocks} Block(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-2.5">Block</th>
                  <th className="py-2.5 px-2.5">Time</th>
                  <th className="py-2.5 px-2.5">Sensor &amp; Location</th>
                  <th className="py-2.5 px-2.5 text-right">Temp</th>
                  <th className="py-2.5 px-2.5 text-right">Condition</th>
                  <th className="py-2.5 px-2.5 text-right">Blockchain Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {telemetryChain.blocks.map((blk) => {
                  const t = blk.event;
                  const isTargetTampered = tamperedBlockId === t.id;
                  return (
                    <tr
                      key={t.id}
                      className={
                        !blk.isBlockValid
                          ? 'bg-rose-950/25'
                          : 'hover:bg-slate-950/60'
                      }
                    >
                      <td className="py-3 px-2.5 font-mono font-semibold text-slate-300 tabular-nums whitespace-nowrap">
                        #{blk.blockIndex}
                      </td>
                      <td className="py-3 px-2.5 font-mono text-slate-400 whitespace-nowrap">
                        {t.timestamp.slice(11, 19)} UTC
                      </td>
                      <td className="py-3 px-2.5 text-slate-200">
                        <div>{t.locationLabel}</div>
                        <div className="text-[11px] font-mono text-slate-400">{t.deviceId}</div>
                        {blk.tamperReason && (
                          <div className="text-[11px] text-rose-300 mt-0.5">{blk.tamperReason}</div>
                        )}
                      </td>
                      <td
                        className={`py-3 px-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                          isTargetTampered
                            ? 'text-rose-300 underline decoration-rose-500'
                            : t.isBreached
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {t.temperature.toFixed(1)}°C
                      </td>
                      <td className="py-3 px-2.5 text-right font-medium whitespace-nowrap">
                        {t.isBreached ? (
                          <span className="text-rose-400">
                            {t.breachType === 'SUBCOOLING' ? 'Too Cold' : 'Overheated'}
                          </span>
                        ) : (
                          <span className="text-emerald-400">Safe</span>
                        )}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap">
                        <div
                          className={`inline-flex items-center gap-1 font-semibold ${
                            blk.isBlockValid ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {blk.isBlockValid ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              INTACT
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5" />
                              {isTargetTampered ? 'TAMPERED' : 'BROKEN LINK'}
                            </>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          hash: {shortHash(blk.recordedBlockHash, 8, 4)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          prev: {shortHash(blk.prevBlockHash, 8, 4)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
