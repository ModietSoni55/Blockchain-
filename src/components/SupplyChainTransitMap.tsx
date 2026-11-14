import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ComposableMap,
  ZoomableGroup,
  Geographies,
  Geography,
  Graticule,
  Sphere,
  Line,
  Marker,
  GeographiesProps,
} from 'react-simple-maps';
import { ZoomIn, ZoomOut, RotateCcw, Globe, Plane, Truck, Ship, Package, Search } from 'lucide-react';
import worldCountries110m from 'world-atlas/countries-110m.json';
import worldCountries50m from 'world-atlas/countries-50m.json';
import usStates10m from 'us-atlas/states-10m.json';
import {
  LogisticsHubNode,
  TransitRouteCorridor,
  BottleneckStatus,
  MapRegionKey,
  TransportMode,
  MedicinePackRecord,
  CustodyEvent,
  evaluateLogisticsBottleneck,
} from '../utils/sentinelLogic';
import { formatPackStatusLabel } from '../utils/uiLabels';

interface SupplyChainTransitMapProps {
  hubs: LogisticsHubNode[];
  corridors: TransitRouteCorridor[];
  packs?: MedicinePackRecord[];
  custodyEvents?: CustodyEvent[];
  trackedPackSerial?: string | null;
  onSelectTrackedPack?: (serial: string | null) => void;
  onInspectPack?: (serial: string) => void;
  onRerouteCorridor?: (corridorId: string) => void;
  onClearHubBottleneck?: (hubId: string) => void;
}

interface RegionMapConfig {
  key: MapRegionKey;
  label: string;
  subtitle: string;
  projection: 'geoNaturalEarth1' | 'geoAlbersUsa' | 'geoMercator';
  projectionConfig: {
    scale: number;
    center?: [number, number];
  };
  defaultCenter: [number, number];
  geography: GeographiesProps['geography'];
}

const REGION_CONFIGS: Record<MapRegionKey, RegionMapConfig> = {
  GLOBAL: {
    key: 'GLOBAL',
    label: 'Global Network',
    subtitle: 'Global Cold-Chain Logistics Network',
    projection: 'geoNaturalEarth1',
    projectionConfig: { scale: 136, center: [10, 4] },
    defaultCenter: [10, 4],
    geography: worldCountries110m as unknown as GeographiesProps['geography'],
  },
  NORTH_AMERICA: {
    key: 'NORTH_AMERICA',
    label: 'United States',
    subtitle: 'United States Logistics Corridors',
    projection: 'geoAlbersUsa',
    projectionConfig: { scale: 900 },
    defaultCenter: [-96, 38],
    geography: usStates10m as unknown as GeographiesProps['geography'],
  },
  EUROPE: {
    key: 'EUROPE',
    label: 'Europe',
    subtitle: 'European Union & UK Cold-Chain Routes',
    projection: 'geoMercator',
    projectionConfig: { scale: 1350, center: [5.5, 49.5] },
    defaultCenter: [5.5, 49.5],
    geography: worldCountries50m as unknown as GeographiesProps['geography'],
  },
  ASIA_PACIFIC: {
    key: 'ASIA_PACIFIC',
    label: 'Asia-Pacific',
    subtitle: 'Asia-Pacific Cold Air & Sea Lanes',
    projection: 'geoMercator',
    projectionConfig: { scale: 450, center: [106, 20] },
    defaultCenter: [106, 20],
    geography: worldCountries50m as unknown as GeographiesProps['geography'],
  },
};

const HUB_LABEL_OFFSETS: Record<
  string,
  { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
> = {
  'hub-sanfrancisco': { x: -10, y: 4, anchor: 'end' },
  'hub-memphis': { x: -10, y: 12, anchor: 'end' },
  'hub-chicago': { x: -10, y: -8, anchor: 'end' },
  'hub-kalamazoo': { x: 0, y: -12, anchor: 'middle' },
  'hub-cleveland': { x: 0, y: 16, anchor: 'middle' },
  'hub-newark': { x: 11, y: 8, anchor: 'start' },
  'hub-boston': { x: 10, y: -10, anchor: 'start' },
  'hub-atlanta': { x: 10, y: 14, anchor: 'start' },
  'hub-basel': { x: 0, y: 16, anchor: 'middle' },
  'hub-frankfurt': { x: 11, y: -4, anchor: 'start' },
  'hub-brussels': { x: 0, y: -13, anchor: 'middle' },
  'hub-london': { x: -11, y: -6, anchor: 'end' },
  'hub-hyderabad': { x: 11, y: -6, anchor: 'start' },
  'hub-mumbai': { x: -11, y: 6, anchor: 'end' },
  'hub-singapore': { x: 0, y: 16, anchor: 'middle' },
  'hub-tokyo': { x: 11, y: -4, anchor: 'start' },
};

const GLOBAL_IATA_OFFSETS: Record<
  string,
  { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
> = {
  'hub-sanfrancisco': { x: -9, y: 3, anchor: 'end' },
  'hub-chicago': { x: -10, y: -3, anchor: 'end' },
  'hub-kalamazoo': { x: -2, y: -12, anchor: 'middle' },
  'hub-memphis': { x: -9, y: 11, anchor: 'end' },
  'hub-atlanta': { x: 8, y: 12, anchor: 'start' },
  'hub-cleveland': { x: 7, y: 14, anchor: 'start' },
  'hub-newark': { x: 11, y: 4, anchor: 'start' },
  'hub-boston': { x: 10, y: -10, anchor: 'start' },
  'hub-london': { x: -10, y: -5, anchor: 'end' },
  'hub-brussels': { x: -2, y: -12, anchor: 'middle' },
  'hub-frankfurt': { x: 10, y: -2, anchor: 'start' },
  'hub-basel': { x: 4, y: 14, anchor: 'start' },
  'hub-mumbai': { x: -9, y: 5, anchor: 'end' },
  'hub-hyderabad': { x: 10, y: -4, anchor: 'start' },
  'hub-singapore': { x: 0, y: 14, anchor: 'middle' },
  'hub-tokyo': { x: 10, y: -4, anchor: 'start' },
};

export const SupplyChainTransitMap: React.FC<SupplyChainTransitMapProps> = ({
  hubs,
  corridors,
  packs = [],
  custodyEvents = [],
  trackedPackSerial = null,
  onSelectTrackedPack,
  onInspectPack,
  onRerouteCorridor,
  onClearHubBottleneck,
}) => {
  const [mapRegion, setMapRegion] = useState<MapRegionKey>('GLOBAL');
  const [mapZoom, setMapZoom] = useState<number>(1);
  const [mapCenter, setMapCenter] = useState<[number, number]>(REGION_CONFIGS.GLOBAL.defaultCenter);
  const [selectedBatchFilter, setSelectedBatchFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [selectedModeFilter, setSelectedModeFilter] = useState<string>('ALL');
  const [internalTrackedSerial, setInternalTrackedSerial] = useState<string | null>(null);
  const [selectedHubId, setSelectedHubId] = useState<string>(hubs[3]?.id || hubs[0]?.id || '');
  const [selectedCorridorId, setSelectedCorridorId] = useState<string | null>(null);
  const [hoveredHubId, setHoveredHubId] = useState<string | null>(null);
  const [hoveredCorridorId, setHoveredCorridorId] = useState<string | null>(null);
  const [showPackBlocks, setShowPackBlocks] = useState<boolean>(false);
  const lastTrackedKeyRef = useRef<string>('');

  const activeTrackedSerial = onSelectTrackedPack
    ? (trackedPackSerial ?? null)
    : internalTrackedSerial;

  const setTrackedSerial = (serial: string | null) => {
    setInternalTrackedSerial(serial);
    if (onSelectTrackedPack) onSelectTrackedPack(serial);
  };

  const activeRegionConfig = REGION_CONFIGS[mapRegion];

  const uniqueBatchCodes = useMemo(() => {
    const set = new Set<string>();
    corridors.forEach((c) => set.add(c.batchCode));
    return Array.from(set);
  }, [corridors]);

  const hubById = useMemo(() => {
    const map = new Map<string, LogisticsHubNode>();
    hubs.forEach((h) => map.set(h.id, h));
    return map;
  }, [hubs]);

  const visibleHubs = useMemo(() => {
    if (mapRegion === 'GLOBAL') return hubs;
    return hubs.filter((h) => (h.region || 'NORTH_AMERICA') === mapRegion);
  }, [hubs, mapRegion]);

  const visibleHubIdSet = useMemo(
    () => new Set(visibleHubs.map((h) => h.id)),
    [visibleHubs]
  );

  // Corridors matching batch + status + transport mode filter (shown in table for selected scope)
  const filteredTableCorridors = useMemo(() => {
    return corridors.filter((c) => {
      const matchesBatch =
        selectedBatchFilter === 'ALL' || c.batchCode === selectedBatchFilter;
      const matchesStatus =
        selectedStatusFilter === 'ALL' || c.status === selectedStatusFilter;
      const matchesMode =
        selectedModeFilter === 'ALL' ||
        (c.transportMode || 'REEFER_TRUCK') === selectedModeFilter;
      if (!matchesBatch || !matchesStatus || !matchesMode) return false;
      if (mapRegion === 'GLOBAL') return true;
      return visibleHubIdSet.has(c.fromHubId) || visibleHubIdSet.has(c.toHubId);
    });
  }, [
    corridors,
    selectedBatchFilter,
    selectedStatusFilter,
    selectedModeFilter,
    mapRegion,
    visibleHubIdSet,
  ]);

  // Corridors drawn inside the active map viewport (both endpoints inside regional projection, or all in GLOBAL)
  const mapDrawnCorridors = useMemo(() => {
    return corridors.filter((c) => {
      const matchesBatch =
        selectedBatchFilter === 'ALL' || c.batchCode === selectedBatchFilter;
      const matchesStatus =
        selectedStatusFilter === 'ALL' || c.status === selectedStatusFilter;
      const matchesMode =
        selectedModeFilter === 'ALL' ||
        (c.transportMode || 'REEFER_TRUCK') === selectedModeFilter;
      if (!matchesBatch || !matchesStatus || !matchesMode) return false;
      if (mapRegion === 'GLOBAL') return true;
      return visibleHubIdSet.has(c.fromHubId) && visibleHubIdSet.has(c.toHubId);
    });
  }, [
    corridors,
    selectedBatchFilter,
    selectedStatusFilter,
    selectedModeFilter,
    mapRegion,
    visibleHubIdSet,
  ]);

  const activeHub = useMemo(() => {
    return hubs.find((h) => h.id === selectedHubId) || visibleHubs[0] || hubs[0];
  }, [hubs, visibleHubs, selectedHubId]);

  const activeCorridor = useMemo(() => {
    if (!selectedCorridorId) return null;
    return corridors.find((c) => c.id === selectedCorridorId) || null;
  }, [corridors, selectedCorridorId]);

  const hoveredHub = useMemo(
    () => (hoveredHubId ? hubById.get(hoveredHubId) || null : null),
    [hoveredHubId, hubById]
  );

  const hoveredCorridor = useMemo(
    () => (hoveredCorridorId ? corridors.find((c) => c.id === hoveredCorridorId) || null : null),
    [hoveredCorridorId, corridors]
  );

  // Find hub matching any text location or coordinates
  const matchHubForLocation = (
    locationText?: string,
    lat?: number,
    lon?: number
  ): LogisticsHubNode | undefined => {
    if (locationText) {
      const lower = locationText.toLowerCase();
      const byText = hubs.find(
        (h) =>
          lower.includes(h.name.toLowerCase()) ||
          lower.includes(h.cityState.toLowerCase()) ||
          lower.includes(h.cityState.split(',')[0].toLowerCase()) ||
          (h.iataCode && lower.includes(h.iataCode.toLowerCase()))
      );
      if (byText) return byText;
    }
    if (typeof lat === 'number' && typeof lon === 'number') {
      let best: LogisticsHubNode | undefined;
      let bestDist = Infinity;
      for (const h of hubs) {
        const d = Math.hypot(h.coordinates[1] - lat, h.coordinates[0] - lon);
        if (d < bestDist) {
          bestDist = d;
          best = h;
        }
      }
      if (best && bestDist < 2.5) return best;
    }
    return undefined;
  };

  const trackedPack = useMemo(
    () =>
      activeTrackedSerial
        ? packs.find((p) => p.serialNumber === activeTrackedSerial) || null
        : null,
    [packs, activeTrackedSerial]
  );

  const trackedPackEvents = useMemo(() => {
    if (!trackedPack) return [];
    const matched = custodyEvents.filter(
      (e) => e.serialHash.toLowerCase() === trackedPack.serialHash.toLowerCase()
    );
    return [...matched].reverse();
  }, [trackedPack, custodyEvents]);

  const trackedPackHops = useMemo(() => {
    if (!trackedPack) return [];
    const hops: Array<{
      label: string;
      iata: string;
      coordinates: [number, number];
      action: string;
      txHash: string;
    }> = [];
    for (const evt of trackedPackEvents) {
      const h = matchHubForLocation(evt.location);
      if (h) {
        const last = hops[hops.length - 1];
        if (!last || last.coordinates[0] !== h.coordinates[0] || last.coordinates[1] !== h.coordinates[1]) {
          hops.push({
            label: h.cityState,
            iata: h.iataCode || h.cityState.split(',')[0],
            coordinates: h.coordinates,
            action: evt.action,
            txHash: evt.txHash,
          });
        }
      }
    }
    if (typeof trackedPack.lastScanLon === 'number' && typeof trackedPack.lastScanLat === 'number') {
      const curHub = matchHubForLocation(
        trackedPack.lastScannedLocation,
        trackedPack.lastScanLat,
        trackedPack.lastScanLon
      );
      const coords: [number, number] = curHub
        ? curHub.coordinates
        : [trackedPack.lastScanLon, trackedPack.lastScanLat];
      const last = hops[hops.length - 1];
      if (!last || Math.hypot(last.coordinates[0] - coords[0], last.coordinates[1] - coords[1]) > 0.05) {
        hops.push({
          label: curHub?.cityState || trackedPack.lastScannedLocation || 'Current Location',
          iata: curHub?.iataCode || trackedPack.serialNumber.slice(-4),
          coordinates: coords,
          action: trackedPack.status,
          txHash: trackedPackEvents[trackedPackEvents.length - 1]?.txHash || '',
        });
      }
    }
    return hops;
  }, [trackedPack, trackedPackEvents, hubs]);

  const packsAtActiveHub = useMemo(() => {
    if (!activeHub) return [];
    return packs.filter((p) => {
      const h = matchHubForLocation(p.lastScannedLocation, p.lastScanLat, p.lastScanLon);
      return h?.id === activeHub.id;
    });
  }, [packs, activeHub, hubs]);

  // Auto-focus hub & regional viewport when a Pack ID is tracked or moves to a new hub/continent
  useEffect(() => {
    if (!trackedPack) {
      lastTrackedKeyRef.current = '';
      return;
    }
    const trackingKey = `${trackedPack.serialNumber}|${trackedPack.lastScannedLocation || ''}|${trackedPack.status}`;
    if (lastTrackedKeyRef.current === trackingKey) return;
    lastTrackedKeyRef.current = trackingKey;

    const h = matchHubForLocation(
      trackedPack.lastScannedLocation,
      trackedPack.lastScanLat,
      trackedPack.lastScanLon
    );
    if (h) {
      setSelectedHubId(h.id);
      if (h.region && REGION_CONFIGS[h.region] && mapRegion !== h.region) {
        const cfg = REGION_CONFIGS[h.region];
        setMapRegion(h.region);
        setMapZoom(1);
        setMapCenter(cfg.defaultCenter);
      }
    }
  }, [trackedPack?.serialNumber, trackedPack?.lastScannedLocation, trackedPack?.status]);

  const activeHubEvaluation = useMemo(() => {
    if (!activeHub) {
      return {
        status: 'OPTIMAL' as BottleneckStatus,
        severityScore: 0,
        recommendation: '',
      };
    }
    return evaluateLogisticsBottleneck({
      dwellHours: activeHub.dwellHours,
      maxSafeDwellHours: activeHub.maxSafeDwellHours,
      excursionCount: activeHub.excursionCount,
      throughputCapacityPct: activeHub.throughputCapacityPct,
    });
  }, [activeHub]);

  const getStatusStrokeColor = (status: BottleneckStatus): string => {
    if (status === 'CRITICAL_BOTTLENECK') return '#f43f5e'; // rose-500
    if (status === 'CONGESTED') return '#f59e0b'; // amber-500
    return '#10b981'; // emerald-500
  };

  const getHubNodeStatus = (hub: LogisticsHubNode): BottleneckStatus => {
    return evaluateLogisticsBottleneck({
      dwellHours: hub.dwellHours,
      maxSafeDwellHours: hub.maxSafeDwellHours,
      excursionCount: hub.excursionCount,
      throughputCapacityPct: hub.throughputCapacityPct,
    }).status;
  };

  const bottleneckHubCount = useMemo(
    () => visibleHubs.filter((h) => getHubNodeStatus(h) !== 'OPTIMAL').length,
    [visibleHubs]
  );

  const handleRegionChange = (nextRegion: MapRegionKey) => {
    const cfg = REGION_CONFIGS[nextRegion];
    setMapRegion(nextRegion);
    setMapZoom(1);
    setMapCenter(cfg.defaultCenter);
    setSelectedCorridorId(null);

    if (nextRegion !== 'GLOBAL') {
      const regionHubs = hubs.filter((h) => (h.region || 'NORTH_AMERICA') === nextRegion);
      const currentInRegion = regionHubs.some((h) => h.id === selectedHubId);
      if (!currentInRegion && regionHubs.length > 0) {
        const bottlenecked = regionHubs.find((h) => getHubNodeStatus(h) !== 'OPTIMAL');
        setSelectedHubId((bottlenecked || regionHubs[0]).id);
      }
    }
  };

  const handleSelectCorridor = (corridor: TransitRouteCorridor) => {
    setSelectedCorridorId(corridor.id);
    const toHub = hubById.get(corridor.toHubId);
    if (toHub) {
      setSelectedHubId(toHub.id);
    }
  };

  const renderTransportBadge = (mode?: TransportMode) => {
    if (mode === 'AIR_CARGO') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sky-300 font-mono">
          <Plane className="w-3 h-3 shrink-0" />
          Air Cargo
        </span>
      );
    }
    if (mode === 'MARITIME_COLD') {
      return (
        <span className="inline-flex items-center gap-1.5 text-teal-300 font-mono">
          <Ship className="w-3 h-3 shrink-0" />
          Maritime Cold
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-300 font-mono">
        <Truck className="w-3 h-3 shrink-0" />
        Reefer Truck
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
      {/* Header & Interactive Map Region + Corridor Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-100">
              Live Transit Map &amp; Route Bottlenecks
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Click any city hub or route line to inspect wait times, storage temperatures, or clear delays.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Region Map Switcher */}
          <div
            role="group"
            aria-label="Map Region Selector"
            className="inline-flex flex-wrap max-w-full gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
          >
            {(['GLOBAL', 'NORTH_AMERICA', 'EUROPE', 'ASIA_PACIFIC'] as MapRegionKey[]).map(
              (rk) => (
                <button
                  key={rk}
                  type="button"
                  onClick={() => handleRegionChange(rk)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    mapRegion === rk
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {REGION_CONFIGS[rk].label}
                </button>
              )
            )}
          </div>

          {/* Batch Filter */}
          <select
            aria-label="Filter Transit Map by Batch"
            value={selectedBatchFilter}
            onChange={(e) => setSelectedBatchFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono"
          >
            <option value="ALL">All Batches ({corridors.length})</option>
            {uniqueBatchCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          {/* Track Individual Product ID Selector */}
          {packs.length > 0 && (
            <select
              aria-label="Track Product ID on Map"
              value={activeTrackedSerial || 'NONE'}
              onChange={(e) =>
                setTrackedSerial(e.target.value === 'NONE' ? null : e.target.value)
              }
              className="px-2.5 py-1.5 bg-slate-950 border border-emerald-700/70 rounded-lg text-xs text-emerald-300 font-mono"
            >
              <option value="NONE">Track Product ID (All Packs: {packs.length})</option>
              {packs.map((pk) => (
                <option key={pk.serialNumber} value={pk.serialNumber}>
                  {pk.serialNumber} · {formatPackStatusLabel(pk.status)}
                </option>
              ))}
            </select>
          )}

          {/* Transport Mode Filter */}
          <select
            aria-label="Filter Transit Map by Transport Mode"
            value={selectedModeFilter}
            onChange={(e) => setSelectedModeFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono"
          >
            <option value="ALL">All Modes</option>
            <option value="REEFER_TRUCK">Reefer Truck</option>
            <option value="AIR_CARGO">Air Cargo</option>
            <option value="MARITIME_COLD">Maritime Cold</option>
          </select>

          {/* Corridor Status Filter */}
          <div className="inline-flex flex-wrap max-w-full gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            {(['ALL', 'OPTIMAL', 'CONGESTED', 'CRITICAL_BOTTLENECK'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setSelectedStatusFilter(st)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  selectedStatusFilter === st
                    ? 'bg-emerald-600 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st === 'ALL' && 'All Lanes'}
                {st === 'OPTIMAL' && 'Optimal'}
                {st === 'CONGESTED' && 'Congested'}
                {st === 'CRITICAL_BOTTLENECK' && 'Critical'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Map Canvas + Hub Bottleneck Telemetry Inspector Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Multi-Region ComposableMap with ZoomableGroup & Floating HUD */}
        <div
          data-testid="supply-chain-transit-map"
          className="lg:col-span-8 min-w-0 bg-slate-950 border border-slate-800 rounded-xl p-4 relative overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 mb-2 px-1">
            <span>{activeRegionConfig.subtitle}</span>
            <span className="font-mono text-amber-300 tabular-nums">
              Delays: {bottleneckHubCount} / {visibleHubs.length} Hubs ·{' '}
              <span className="text-slate-400">{mapDrawnCorridors.length} Routes</span>
            </span>
          </div>

          <div className="w-full h-[395px] relative flex items-center justify-center rounded-lg bg-[radial-gradient(circle_at_50%_45%,_#07142b_0%,_#020714_100%)] border border-slate-900 overflow-hidden">
            {/* Floating Zoom / Pan HUD Overlay */}
            <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 bg-slate-900/95 border border-slate-700/80 rounded-lg p-1 shadow-lg">
              <span className="px-1.5 text-[10px] font-mono text-slate-400 tabular-nums">
                {mapZoom.toFixed(1)}x
              </span>
              <button
                type="button"
                aria-label="Zoom in map"
                onClick={() => setMapZoom((z) => Math.min(4, Math.round((z + 0.5) * 10) / 10))}
                className="p-1 hover:bg-slate-800 text-slate-200 rounded transition-colors"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Zoom out map"
                onClick={() => setMapZoom((z) => Math.max(1, Math.round((z - 0.5) * 10) / 10))}
                className="p-1 hover:bg-slate-800 text-slate-200 rounded transition-colors"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Reset map view"
                onClick={() => {
                  setMapZoom(1);
                  setMapCenter(activeRegionConfig.defaultCenter);
                }}
                className="p-1 hover:bg-slate-800 text-slate-200 rounded transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Floating Live Hover Readout HUD */}
            {(hoveredHub || hoveredCorridor) && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 bg-slate-900/95 border border-slate-700/80 rounded-lg px-3 py-2 text-[11px] font-mono shadow-lg max-w-sm">
                {hoveredHub ? (
                  <div className="space-y-0.5">
                    <div className="text-slate-100 font-semibold">
                      {hoveredHub.name} ({hoveredHub.iataCode || hoveredHub.cityState})
                    </div>
                    <div className="text-slate-400">
                      Temp {hoveredHub.avgTempC.toFixed(1)}°C · Dwell {hoveredHub.dwellHours.toFixed(1)}h · Vault{' '}
                      {hoveredHub.throughputCapacityPct}%
                    </div>
                  </div>
                ) : hoveredCorridor ? (
                  <div className="space-y-0.5">
                    <div className="text-sky-300 font-semibold">
                      {hubById.get(hoveredCorridor.fromHubId)?.iataCode || hoveredCorridor.fromHubId} →{' '}
                      {hubById.get(hoveredCorridor.toHubId)?.iataCode || hoveredCorridor.toHubId} ·{' '}
                      {hoveredCorridor.batchCode}
                    </div>
                    <div className="text-slate-400">
                      {hoveredCorridor.distanceKm.toLocaleString()} km · {hoveredCorridor.actualHours.toFixed(1)}h /{' '}
                      {hoveredCorridor.estimatedHours.toFixed(1)}h SLA
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <ComposableMap
              key={mapRegion}
              projection={activeRegionConfig.projection}
              projectionConfig={activeRegionConfig.projectionConfig}
              width={780}
              height={410}
              style={{ width: '100%', height: '100%' }}
            >
              <ZoomableGroup
                center={mapCenter}
                zoom={mapZoom}
                minZoom={1}
                maxZoom={4}
                onMoveEnd={({ coordinates, zoom }) => {
                  if (coordinates) setMapCenter(coordinates);
                  if (typeof zoom === 'number') setMapZoom(zoom);
                }}
              >
                {mapRegion === 'GLOBAL' && (
                  <>
                    <Sphere
                      id="rsm-global-sphere"
                      fill="#040d1f"
                      stroke="#1e293b"
                      strokeWidth={0.8}
                    />
                    <Graticule stroke="#0f1f38" strokeWidth={0.5} step={[20, 20]} />
                  </>
                )}
                {(mapRegion === 'EUROPE' || mapRegion === 'ASIA_PACIFIC') && (
                  <Graticule stroke="#0e1c33" strokeWidth={0.45} step={[10, 10]} />
                )}

                <Geographies geography={activeRegionConfig.geography}>
                  {({ geographies }) =>
                    geographies.map((geo) => (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        stroke="#253856"
                        strokeWidth={mapRegion === 'GLOBAL' ? 0.55 : 0.9}
                        className="fill-[#111d33] hover:fill-[#182947] active:fill-[#1e3256] outline-none transition-colors"
                      />
                    ))
                  }
                </Geographies>

                {/* Great-Circle Transit Route Corridors */}
                {mapDrawnCorridors.map((corridor) => {
                  const strokeColor = getStatusStrokeColor(corridor.status);
                  const isSelected = selectedCorridorId === corridor.id;
                  const isHovered = hoveredCorridorId === corridor.id;
                  const isAir = corridor.transportMode === 'AIR_CARGO';
                  const isSea = corridor.transportMode === 'MARITIME_COLD';
                  const dash =
                    corridor.status === 'CRITICAL_BOTTLENECK'
                      ? '6 4'
                      : isAir
                      ? '6 3'
                      : isSea
                      ? '2.5 3.5'
                      : corridor.status === 'CONGESTED'
                      ? '5 3.5'
                      : undefined;

                  return (
                    <g
                      key={corridor.id}
                      onClick={() => handleSelectCorridor(corridor)}
                      onMouseEnter={() => setHoveredCorridorId(corridor.id)}
                      onMouseLeave={() => setHoveredCorridorId(null)}
                      className="cursor-pointer"
                    >
                      {/* Invisible wide hit target for smooth route clicking */}
                      <Line
                        from={corridor.fromCoordinates}
                        to={corridor.toCoordinates}
                        stroke="transparent"
                        strokeWidth={10 / Math.sqrt(mapZoom)}
                      />
                      {/* Subtle halo under selected, hovered, or bottleneck route */}
                      {(isSelected || isHovered || corridor.status === 'CRITICAL_BOTTLENECK') && (
                        <Line
                          from={corridor.fromCoordinates}
                          to={corridor.toCoordinates}
                          stroke={isSelected || isHovered ? '#38bdf8' : strokeColor}
                          strokeOpacity={isSelected ? 0.38 : 0.24}
                          strokeWidth={(isSelected ? 7.5 : 5.5) / Math.sqrt(mapZoom)}
                          strokeLinecap="round"
                        />
                      )}
                      <Line
                        from={corridor.fromCoordinates}
                        to={corridor.toCoordinates}
                        stroke={isSelected || isHovered ? '#38bdf8' : strokeColor}
                        strokeWidth={
                          (isSelected || isHovered
                            ? 2.8
                            : corridor.status !== 'OPTIMAL'
                            ? 2.3
                            : 1.75) / Math.sqrt(mapZoom)
                        }
                        strokeLinecap="round"
                        strokeDasharray={dash}
                      />
                    </g>
                  );
                })}

                {/* Tracked Pack Live Custody Trail Overlay */}
                {trackedPack &&
                  trackedPackHops.length > 1 &&
                  trackedPackHops.slice(0, -1).map((hop, idx) => {
                    const nextHop = trackedPackHops[idx + 1];
                    const invScale = 1 / Math.sqrt(mapZoom);
                    return (
                      <g key={`${hop.iata}-${nextHop.iata}-${idx}`}>
                        <Line
                          from={hop.coordinates}
                          to={nextHop.coordinates}
                          stroke="#22d3ee"
                          strokeOpacity={0.35}
                          strokeWidth={7 * invScale}
                          strokeLinecap="round"
                        />
                        <Line
                          from={hop.coordinates}
                          to={nextHop.coordinates}
                          stroke="#22d3ee"
                          strokeWidth={3 * invScale}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}

                {/* Regional Hub Markers */}
                {visibleHubs.map((hub) => {
                  const hubStatus = getHubNodeStatus(hub);
                  const markerColor = getStatusStrokeColor(hubStatus);
                  const isSelected = activeHub?.id === hub.id;
                  const isHovered = hoveredHubId === hub.id;
                  const offsetTable =
                    mapRegion === 'GLOBAL' ? GLOBAL_IATA_OFFSETS : HUB_LABEL_OFFSETS;
                  const lp = offsetTable[hub.id] || {
                    x: 0,
                    y: -11,
                    anchor: 'middle' as const,
                  };
                  const labelText =
                    mapRegion === 'GLOBAL'
                      ? hub.iataCode || hub.cityState.split(',')[0]
                      : hub.cityState;
                  const invScale = 1 / Math.sqrt(mapZoom);

                  return (
                    <Marker
                      key={hub.id}
                      coordinates={hub.coordinates}
                      onClick={() => {
                        setSelectedHubId(hub.id);
                        setSelectedCorridorId(null);
                      }}
                      onMouseEnter={() => setHoveredHubId(hub.id)}
                      onMouseLeave={() => setHoveredHubId(null)}
                    >
                      <g className="cursor-pointer">
                        {(isSelected || isHovered) && (
                          <circle
                            r={12.5 * invScale}
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth={1.6 * invScale}
                            strokeDasharray="3 2"
                          />
                        )}
                        {hubStatus === 'CRITICAL_BOTTLENECK' && !isSelected && (
                          <circle
                            r={10.5 * invScale}
                            fill="#f43f5e"
                            fillOpacity={0.18}
                            stroke="#f43f5e"
                            strokeOpacity={0.6}
                            strokeWidth={1 * invScale}
                          />
                        )}
                        <circle
                          r={(hubStatus === 'CRITICAL_BOTTLENECK' ? 6.5 : 5.2) * invScale}
                          fill={markerColor}
                          stroke="#020617"
                          strokeWidth={1.6 * invScale}
                        />
                        <text
                          textAnchor={lp.anchor}
                          x={lp.x * invScale}
                          y={lp.y * invScale}
                          style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: `${(mapRegion === 'GLOBAL' ? 8.5 : 9.5) * invScale}px`,
                            fontWeight: isSelected || isHovered ? 700 : 600,
                            fill: isSelected || isHovered ? '#f8fafc' : '#cbd5e1',
                            stroke: '#020617',
                            strokeWidth: 3 * invScale,
                            paintOrder: 'stroke',
                          }}
                        >
                          {labelText}
                        </text>
                      </g>
                    </Marker>
                  );
                })}

                {/* Live Product ID Marker(s) Overlaid at Actual Pack Coordinates */}
                {trackedPack &&
                  typeof trackedPack.lastScanLon === 'number' &&
                  typeof trackedPack.lastScanLat === 'number' && (() => {
                    const invScale = 1 / Math.sqrt(mapZoom);
                    const badgeCoords: [number, number] = [
                      trackedPack.lastScanLon,
                      trackedPack.lastScanLat,
                    ];
                    const badgeText = `${trackedPack.serialNumber} · ${formatPackStatusLabel(trackedPack.status)}`;
                    const badgeWidth = Math.max(155, badgeText.length * 6.3);
                    const flipBadgeLeft =
                      (mapRegion === 'NORTH_AMERICA' && trackedPack.lastScanLon > -82) ||
                      (mapRegion === 'EUROPE' && trackedPack.lastScanLon > 12) ||
                      (mapRegion === 'ASIA_PACIFIC' && trackedPack.lastScanLon > 118) ||
                      (mapRegion === 'GLOBAL' && trackedPack.lastScanLon > 80);
                    const badgeOffsetX = flipBadgeLeft
                      ? -(badgeWidth + 12) * invScale
                      : 12 * invScale;
                    return (
                      <Marker coordinates={badgeCoords}>
                        <g className="pointer-events-none">
                          <circle
                            r={15 * invScale}
                            fill="#22d3ee"
                            fillOpacity={0.16}
                            stroke="#22d3ee"
                            strokeWidth={1.8 * invScale}
                          />
                          <circle
                            r={5.5 * invScale}
                            fill="#22d3ee"
                            stroke="#020617"
                            strokeWidth={1.5 * invScale}
                          />
                          <g transform={`translate(${badgeOffsetX}, ${-24 * invScale}) scale(${invScale})`}>
                            <rect
                              x={0}
                              y={0}
                              width={badgeWidth}
                              height={22}
                              rx={5}
                              fill="#042f2e"
                              stroke="#22d3ee"
                              strokeWidth={1.2}
                            />
                            <text
                              x={8}
                              y={14}
                              style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '9.5px',
                                fontWeight: 700,
                                fill: '#ecfeff',
                              }}
                            >
                              {badgeText}
                            </text>
                          </g>
                        </g>
                      </Marker>
                    );
                  })()}
              </ZoomableGroup>
            </ComposableMap>
          </div>

          {/* Selected Corridor Callout Strip (appears when a route line or table row is clicked) */}
          {activeCorridor && (
            <div className="mt-3 p-3 rounded-lg bg-slate-900 border border-sky-700/50 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="space-y-0.5">
                <div className="font-mono text-sky-300 font-semibold">
                  Selected Route: {hubById.get(activeCorridor.fromHubId)?.cityState || activeCorridor.fromHubId} →{' '}
                  {hubById.get(activeCorridor.toHubId)?.cityState || activeCorridor.toHubId} ({activeCorridor.batchCode})
                </div>
                <div className="text-slate-300">{activeCorridor.bottleneckDetail}</div>
              </div>
              <div className="flex items-center gap-3 font-mono">
                {renderTransportBadge(activeCorridor.transportMode)}
                <span className="text-slate-300 tabular-nums">{activeCorridor.distanceKm} km</span>
              </div>
            </div>
          )}

          {/* Map Legend & Quick Hub Selector Bar */}
          <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-3.5 font-mono text-[11px]">
              <span className="text-emerald-400">● Optimal</span>
              <span className="text-amber-400">-- Congested</span>
              <span className="text-rose-400">-- Critical</span>
              <span className="text-sky-300">- - Air Cargo</span>
              <span className="text-teal-300">··· Maritime</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-400">Hubs:</span>
              {visibleHubs.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setSelectedHubId(h.id);
                    setSelectedCorridorId(null);
                  }}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap ${
                    activeHub?.id === h.id
                      ? 'bg-sky-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {mapRegion === 'GLOBAL' ? h.iataCode || h.cityState.split(',')[0] : h.cityState.split(',')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right 4 Columns: Live Tracked Pack Card + Selected Hub Inspector */}
        <div className="lg:col-span-4 min-w-0 space-y-4">
          {trackedPack && (
            <div
              data-testid="map-tracked-pack-card"
              className="bg-slate-950 border border-cyan-700/60 rounded-xl p-4 space-y-3 text-xs"
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <div className="flex items-center gap-1.5 text-cyan-300 font-semibold">
                    <Package className="w-3.5 h-3.5" />
                    Live Tracked Product on Map
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-slate-100">
                    {trackedPack.serialNumber}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTrackedSerial(null)}
                  className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <span className="text-slate-400 block">Stage</span>
                  <span className="font-semibold text-emerald-300">
                    {formatPackStatusLabel(trackedPack.status)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Holder Role</span>
                  <span className="font-mono text-slate-200">{trackedPack.custodianRole}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Current Custodian &amp; Hub</span>
                  <span className="text-slate-100 font-medium block">
                    {trackedPack.currentCustodian}
                  </span>
                  <span className="text-slate-400 block truncate">
                    {trackedPack.lastScannedLocation}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block">Keccak-256 Product Hash</span>
                  <span className="font-mono text-[11px] text-emerald-300 break-all">
                    {trackedPack.serialHash.slice(0, 18)}...{trackedPack.serialHash.slice(-8)}
                  </span>
                </div>
              </div>

              {trackedPackHops.length > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-slate-400 block mb-1">Custody Route Trail</span>
                  <div className="font-mono text-[11px] text-cyan-300">
                    {trackedPackHops.map((h) => h.iata).join(' → ')}
                  </div>
                </div>
              )}

              {trackedPackEvents.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowPackBlocks((v) => !v)}
                    className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-300 hover:text-cyan-300 transition-colors"
                  >
                    <span>Custody Blocks ({trackedPackEvents.length})</span>
                    <span className="font-mono text-cyan-300">
                      {showPackBlocks ? 'Hide ▲' : 'Inspect Hashes ▼'}
                    </span>
                  </button>
                  {showPackBlocks && (
                    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                      {trackedPackEvents.map((evt, idx) => (
                        <div
                          key={evt.id}
                          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[10px] space-y-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-emerald-300">
                              #{idx + 1} · {evt.action.replace(/_/g, ' ')}
                            </span>
                            <span className="font-mono text-slate-400 tabular-nums">
                              {evt.timestamp.slice(11, 19)} UTC
                            </span>
                          </div>
                          <div className="text-slate-300 truncate">
                            {evt.fromActor} → {evt.toActor}
                          </div>
                          <div className="text-slate-400 truncate">{evt.location}</div>
                          <div className="font-mono text-cyan-300 truncate">
                            tx: {evt.txHash.slice(0, 14)}...{evt.txHash.slice(-6)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {onInspectPack && (
                <button
                  type="button"
                  onClick={() => onInspectPack(trackedPack.serialNumber)}
                  className="w-full py-1.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5" />
                  Verify Pack &amp; Proofs ({trackedPack.serialNumber})
                </button>
              )}
            </div>
          )}

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
            {activeHub && (
              <>
                <div className="border-b border-slate-800 pb-3.5">
                  <div className="text-xs text-slate-400">
                    {activeHub.role
                      .toLowerCase()
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, (c) => c.toUpperCase())}{' '}
                    · {activeHub.cityState}
                    {activeHub.iataCode ? ` (${activeHub.iataCode})` : ''}
                  </div>
                  <h3 className="text-base font-bold text-slate-100 mt-0.5">
                    {activeHub.name}
                  </h3>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-400">Hub Condition</span>
                    <span
                      className={`font-semibold ${
                        activeHubEvaluation.status === 'CRITICAL_BOTTLENECK'
                          ? 'text-rose-400'
                          : activeHubEvaluation.status === 'CONGESTED'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {activeHubEvaluation.status === 'CRITICAL_BOTTLENECK'
                        ? 'Critical Delay'
                        : activeHubEvaluation.status === 'CONGESTED'
                        ? 'Delayed'
                        : 'Running Smoothly'}{' '}
                      ({activeHubEvaluation.severityScore}/100)
                    </span>
                  </div>
                </div>

                {/* Hub Telemetry Metrics */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                    <span className="text-slate-400 block">Average Dwell Time</span>
                    <span
                      className={`mt-1 text-base font-bold font-mono tabular-nums block ${
                        activeHub.dwellHours > activeHub.maxSafeDwellHours
                          ? 'text-amber-400'
                          : 'text-slate-100'
                      }`}
                    >
                      {activeHub.dwellHours.toFixed(1)}h{' '}
                      <span className="text-[11px] font-normal text-slate-400">
                        / {activeHub.maxSafeDwellHours}h SLA
                      </span>
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                    <span className="text-slate-400 block">Vault Utilization</span>
                    <span
                      className={`mt-1 text-base font-bold font-mono tabular-nums block ${
                        activeHub.throughputCapacityPct >= 85
                          ? 'text-rose-400'
                          : 'text-slate-100'
                      }`}
                    >
                      {activeHub.throughputCapacityPct}%{' '}
                      <span className="text-[11px] font-normal text-slate-400">capacity</span>
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                    <span className="text-slate-400 block">Mean Vault Temp</span>
                    <span
                      className={`mt-1 text-base font-bold font-mono tabular-nums block ${
                        activeHub.avgTempC > 8.0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {activeHub.avgTempC.toFixed(1)}°C
                    </span>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                    <span className="text-slate-400 block">Active Batches</span>
                    <span className="mt-1 text-base font-bold font-mono tabular-nums text-slate-100 block">
                      {activeHub.activeBatches.length} batch(es)
                    </span>
                  </div>
                </div>

                {/* Serialized Packs Currently at This Hub */}
                {packsAtActiveHub.length > 0 && (
                  <div className="space-y-1.5 text-xs pt-1 border-t border-slate-800">
                    <span className="text-slate-400 font-medium block">
                      Packs at {activeHub.cityState} ({packsAtActiveHub.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {packsAtActiveHub.map((pk) => (
                        <button
                          key={pk.serialNumber}
                          type="button"
                          onClick={() => setTrackedSerial(pk.serialNumber)}
                          className={`px-2 py-1 rounded border font-mono text-[11px] transition-colors ${
                            activeTrackedSerial === pk.serialNumber
                              ? 'bg-cyan-950 border-cyan-500 text-cyan-200 font-semibold'
                              : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {pk.serialNumber}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Root Cause & AI Logistics Recommendation */}
                <div className="space-y-2.5 text-xs">
                  <div>
                    <span className="text-slate-400 font-medium block">
                      Regional Bottleneck Diagnosis
                    </span>
                    <p className="mt-1 text-slate-200 leading-relaxed">
                      {activeHub.bottleneckReason ||
                        'Cross-dock handovers and cold-vault telemetry operating within target SLA.'}
                    </p>
                  </div>

                  <div>
                    <span className="text-slate-400 font-medium block">
                      Recommended Logistics Action
                    </span>
                    <p className="mt-1 text-emerald-300 font-medium leading-relaxed">
                      {activeHubEvaluation.recommendation}
                    </p>
                  </div>
                </div>

                {activeHubEvaluation.status !== 'OPTIMAL' && onClearHubBottleneck && (
                  <button
                    type="button"
                    onClick={() => onClearHubBottleneck(activeHub.id)}
                    className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold text-xs rounded-lg transition-colors"
                  >
                    Dispatch Auxiliary Reefer &amp; Resolve Hub Bottleneck
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Corridor Bottleneck Table */}
      <div className="overflow-x-auto pt-2">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2.5 px-3">Batch / Corridor</th>
              <th className="py-2.5 px-3">Mode / Carrier</th>
              <th className="py-2.5 px-3 text-right">Distance</th>
              <th className="py-2.5 px-3 text-right">Transit Time (Actual / SLA)</th>
              <th className="py-2.5 px-3">Bottleneck Diagnosis</th>
              <th className="py-2.5 px-3 text-right">Corridor Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filteredTableCorridors.map((corridor) => {
              const fromLabel =
                hubById.get(corridor.fromHubId)?.iataCode ||
                hubById.get(corridor.fromHubId)?.cityState.split(',')[0] ||
                corridor.fromHubId;
              const toLabel =
                hubById.get(corridor.toHubId)?.iataCode ||
                hubById.get(corridor.toHubId)?.cityState.split(',')[0] ||
                corridor.toHubId;
              const isSelected = selectedCorridorId === corridor.id;
              return (
                <tr
                  key={corridor.id}
                  onClick={() => handleSelectCorridor(corridor)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-sky-950/30' : 'hover:bg-slate-950/60'
                  }`}
                >
                  <td className="py-3 px-3 font-mono font-semibold text-slate-100">
                    <span>{corridor.batchCode}</span>
                    <span className="block text-[11px] font-normal text-slate-400">
                      {fromLabel} → {toLabel} · {corridor.brandName}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    {renderTransportBadge(corridor.transportMode)}
                    <span className="block text-[11px] text-slate-400">{corridor.carrierName}</span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-300">
                    {corridor.distanceKm.toLocaleString()} km
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                    <span
                      className={
                        corridor.actualHours > corridor.estimatedHours
                          ? 'text-amber-400 font-bold'
                          : 'text-emerald-400'
                      }
                    >
                      {corridor.actualHours.toFixed(1)}h
                    </span>{' '}
                    <span className="text-slate-500">/ {corridor.estimatedHours.toFixed(1)}h</span>
                  </td>
                  <td className="py-3 px-3 text-slate-300">{corridor.bottleneckDetail}</td>
                  <td className="py-3 px-3 text-right">
                    {corridor.status !== 'OPTIMAL' && onRerouteCorridor ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRerouteCorridor(corridor.id);
                        }}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                      >
                        Reroute Express
                      </button>
                    ) : (
                      <span className="text-emerald-400 font-medium">On Schedule</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
