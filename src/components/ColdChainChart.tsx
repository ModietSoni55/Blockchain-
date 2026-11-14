import React, { useState } from 'react';
import { TelemetryEvent } from '../utils/sentinelLogic';

interface ColdChainChartProps {
  readings: TelemetryEvent[];
  minTemp: number;
  maxTemp: number;
  mktValue: number;
}

/**
 * Interactive SVG Thermal Telemetry Envelope Chart
 * Plots time-series temperature points against the batch's safe [minTemp, maxTemp] envelope
 * with gradient thermal area fill and interactive point hover inspection.
 */
export const ColdChainChart: React.FC<ColdChainChartProps> = ({
  readings,
  minTemp,
  maxTemp,
  mktValue,
}) => {
  const [hoveredReadingId, setHoveredReadingId] = useState<string | null>(null);
  const ordered = [...readings].reverse();

  const width = 960;
  const height = 220;
  const padLeft = 46;
  const padRight = 56;
  const padTop = 26;
  const padBottom = 36;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const yMin = -2;
  const yMax = 18;

  const toY = (temp: number): number => {
    const clamped = Math.min(Math.max(temp, yMin), yMax);
    const ratio = (clamped - yMin) / (yMax - yMin);
    return padTop + plotH - ratio * plotH;
  };

  const toX = (idx: number, total: number): number => {
    if (total <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (total - 1)) * plotW;
  };

  const safeTopY = toY(maxTemp);
  const safeBottomY = toY(minTemp);
  const safeBandHeight = Math.max(safeBottomY - safeTopY, 2);
  const baselineY = padTop + plotH;

  const points = ordered.map((r, idx) => ({
    x: toX(idx, ordered.length),
    y: toY(r.temperature),
    reading: r,
  }));

  const pointsString = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPolygon =
    points.length > 1
      ? `${points[0].x},${baselineY} ${pointsString} ${points[points.length - 1].x},${baselineY}`
      : '';

  const activeHover =
    points.find((p) => p.reading.id === hoveredReadingId) ||
    (points.length > 0 ? points[points.length - 1] : null);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            Temperature History &amp; Safe Storage Zone ({minTemp.toFixed(1)}°C – {maxTemp.toFixed(1)}°C)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Green shaded area marks the safe storage range. Hover over any reading point for sensor details.
          </p>
        </div>
        <div className="flex items-center gap-5 shrink-0">
          {activeHover && (
            <div className="hidden md:block text-right text-xs font-mono border-r border-slate-800 pr-5">
              <span className="text-slate-400 block">
                {activeHover.reading.deviceId} · {activeHover.reading.timestamp.slice(11, 19)} UTC
              </span>
              <span
                className={`font-semibold ${
                  activeHover.reading.isBreached ? 'text-rose-400' : 'text-sky-300'
                }`}
              >
                {activeHover.reading.temperature.toFixed(1)}°C · {activeHover.reading.locationLabel}
              </span>
            </div>
          )}
          <div className="text-right font-mono">
            <span className="text-xs text-slate-400 block font-sans">Cumulative Heat Average (MKT)</span>
            <span
              className={`text-lg font-bold tabular-nums ${
                mktValue > maxTemp || mktValue < minTemp ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {mktValue.toFixed(2)}°C
            </span>
          </div>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-xs text-slate-500 font-mono">
          No telemetry readings recorded for this batch yet.
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-lg bg-slate-950 border border-slate-800/90 p-3">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto select-none"
            role="img"
            aria-label="Cold-chain temperature time-series chart"
          >
            <defs>
              <linearGradient id="thermalAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="safeEnvelopeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.06" />
              </linearGradient>
            </defs>

            {/* Horizontal grid lines */}
            {[0, 4, 8, 12, 16].map((gridTemp) => {
              const y = toY(gridTemp);
              return (
                <g key={gridTemp}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="#1e293b"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fill="#64748b"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {gridTemp}°C
                  </text>
                </g>
              );
            })}

            {/* Safe temperature band */}
            <rect
              x={padLeft}
              y={safeTopY}
              width={plotW}
              height={safeBandHeight}
              fill="url(#safeEnvelopeGrad)"
            />
            <line
              x1={padLeft}
              y1={safeTopY}
              x2={width - padRight}
              y2={safeTopY}
              stroke="#10b981"
              strokeOpacity={0.55}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <line
              x1={padLeft}
              y1={safeBottomY}
              x2={width - padRight}
              y2={safeBottomY}
              stroke="#10b981"
              strokeOpacity={0.45}
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text
              x={width - padRight + 6}
              y={safeTopY + 3.5}
              fontSize="9"
              fontWeight="600"
              fill="#34d399"
              fontFamily="JetBrains Mono, monospace"
            >
              MAX {maxTemp.toFixed(0)}°
            </text>
            <text
              x={width - padRight + 6}
              y={safeBottomY + 3.5}
              fontSize="9"
              fontWeight="600"
              fill="#34d399"
              fontFamily="JetBrains Mono, monospace"
            >
              MIN {minTemp.toFixed(0)}°
            </text>

            {/* Area fill under temperature curve */}
            {areaPolygon && <polygon points={areaPolygon} fill="url(#thermalAreaGrad)" />}

            {/* Polyline connecting readings */}
            {ordered.length > 1 && (
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={pointsString}
              />
            )}

            {/* Data nodes with hover focus */}
            {points.map(({ x, y, reading }) => {
              const isFocused = activeHover?.reading.id === reading.id;
              return (
                <g
                  key={reading.id}
                  onMouseEnter={() => setHoveredReadingId(reading.id)}
                  onMouseLeave={() => setHoveredReadingId(null)}
                  className="cursor-pointer"
                >
                  {isFocused && (
                    <>
                      <line
                        x1={x}
                        y1={padTop}
                        x2={x}
                        y2={baselineY}
                        stroke="#475569"
                        strokeDasharray="2 2"
                        strokeWidth={1}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={10}
                        fill={reading.isBreached ? '#f43f5e' : '#38bdf8'}
                        fillOpacity={0.2}
                      />
                    </>
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={reading.isBreached ? 5.5 : isFocused ? 5 : 4}
                    fill={reading.isBreached ? '#f43f5e' : '#10b981'}
                    stroke="#020617"
                    strokeWidth={1.6}
                  />
                  <text
                    x={x}
                    y={y - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill={reading.isBreached ? '#fda4af' : '#a7f3d0'}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {reading.temperature.toFixed(1)}°
                  </text>
                  <text
                    x={x}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="9"
                    fill={isFocused ? '#e2e8f0' : '#94a3b8'}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {reading.timestamp.slice(11, 16)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
};
