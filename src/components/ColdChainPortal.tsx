import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { BatchRecord, LogisticsHubNode, TelemetryEvent } from '../utils/sentinelLogic';
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

  return (
    <div className="space-y-7">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-2xl font-bold text-slate-100">Cold-Chain Temperature Monitoring</h1>
        <p className="mt-1 text-sm text-slate-400">
          Monitor live refrigerator sensors across warehouses and trucks. Readings outside the safe
          temperature range automatically raise an alert and pause affected routes.
        </p>
      </div>

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
            Safe limit: {activeIoTBatch.minTemp.toFixed(0)}°C – {activeIoTBatch.maxTemp.toFixed(0)}°C
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
              Log a temperature checkpoint or test how the system responds to overheating.
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

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => onRecordTelemetry()}
              className="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
            >
              Log Reading
            </button>
            <button
              type="button"
              onClick={() => onRecordTelemetry(14.8)}
              className="py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-lg transition-colors whitespace-nowrap"
            >
              Test 14.8°C Overheat Alert
            </button>
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

        {/* Sensor Feed Table */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-100 mb-4">Recent Sensor Readings</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Sensor &amp; Location</th>
                  <th className="py-2.5 px-3 text-right">Temperature</th>
                  <th className="py-2.5 px-3 text-right">Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {telemetry.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-950/60">
                    <td className="py-3 px-3 font-mono text-slate-400">
                      {t.timestamp.slice(11, 19)} UTC
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {t.locationLabel}
                      <span className="block text-[11px] font-mono text-slate-400">{t.deviceId}</span>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono font-bold tabular-nums ${
                        t.isBreached ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {t.temperature.toFixed(1)}°C
                    </td>
                    <td className="py-3 px-3 text-right font-medium">
                      {t.isBreached ? (
                        <span className="text-rose-400">
                          {t.breachType === 'SUBCOOLING' ? 'Too Cold' : 'Overheated'}
                        </span>
                      ) : (
                        <span className="text-emerald-400">Safe</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
