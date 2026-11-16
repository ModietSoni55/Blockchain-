import React, { useState } from 'react';
import {
  Download,
  Layers,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  UserCheck,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import {
  BatchRecord,
  CustodyEvent,
  MedicinePackRecord,
  PalletContainerRecord,
  ParticipantEntity,
  LogisticsHubNode,
  TransitRouteCorridor,
  RoleType,
} from '../utils/sentinelLogic';
import { formatPackStatusLabel } from '../utils/uiLabels';
import { SupplyChainTransitMap } from './SupplyChainTransitMap';

type SupplyRoleTab = 'manufacturer' | 'distributor' | 'pharmacy';

interface SupplyChainPortalProps {
  supplyRoleTab: SupplyRoleTab;
  onChangeSupplyRoleTab: (tab: SupplyRoleTab) => void;
  activeRole: RoleType;
  activeRoleLabel: string;
  onSwitchToRole: (role: RoleType) => void;
  autoSwitchSupplyRole: boolean;
  onToggleAutoSwitchSupplyRole: () => void;
  custodyErrorMsg: string;
  custodySuccessMsg: string;
  onDismissCustodySuccess: () => void;
  liveSseBanner: string;
  onDismissLiveSseBanner: () => void;
  onDownloadAuditCSV: () => void;
  logisticsHubs: LogisticsHubNode[];
  transitCorridors: TransitRouteCorridor[];
  custodyEvents: CustodyEvent[];
  trackedMapPackSerial: string | null;
  onSelectTrackedMapPack: (serial: string | null) => void;
  onRerouteCorridor: (corridorId: string) => void;
  onClearHubBottleneck: (hubId: string) => void;
  pallets: PalletContainerRecord[];
  batches: BatchRecord[];
  packs: MedicinePackRecord[];
  palletBatchId: string;
  onChangePalletBatchId: (batchId: string) => void;
  selectedPalletSerials: string[];
  onTogglePalletSerial: (serial: string) => void;
  onCommissionPallet: () => void;
  palletMsg: string;
  onTransferPallet: (
    pallet: PalletContainerRecord,
    nextCustodian: string,
    nextRole: RoleType,
    hubId: string
  ) => void;
  onDeaggregatePallet: (sscc: string) => void;
  dispatchDistributorName: string;
  onChangeDispatchDistributorName: (val: string) => void;
  dispatchDestinationHubId: string;
  onChangeDispatchDestinationHubId: (val: string) => void;
  deliveryPharmacyName: string;
  onChangeDeliveryPharmacyName: (val: string) => void;
  deliveryHubId: string;
  onChangeDeliveryHubId: (val: string) => void;
  deliveryHandoverTemp: string;
  onChangeDeliveryHandoverTemp: (val: string) => void;
  dispensePatientRef: string;
  onChangeDispensePatientRef: (val: string) => void;
  dispenseClinicDesk: string;
  onChangeDispenseClinicDesk: (val: string) => void;
  authorizedDistributors: ParticipantEntity[];
  authorizedPharmacies: ParticipantEntity[];
  newBatchCode: string;
  onChangeNewBatchCode: (val: string) => void;
  newBrandName: string;
  onChangeNewBrandName: (val: string) => void;
  newOriginHubId: string;
  onChangeNewOriginHubId: (val: string) => void;
  newDestHubId: string;
  onChangeNewDestHubId: (val: string) => void;
  newMinTemp: number;
  onChangeNewMinTemp: (val: number) => void;
  newMaxTemp: number;
  onChangeNewMaxTemp: (val: number) => void;
  batchFormError: string;
  batchFormSuccess: string;
  onCreateBatch: (e: React.FormEvent) => void;
  selectedBatchForMint: string;
  onChangeSelectedBatchForMint: (val: string) => void;
  mintPackCount: number;
  onChangeMintPackCount: (val: number) => void;
  onMintPacks: () => void;
  packFilterQuery: string;
  onChangePackFilterQuery: (val: string) => void;
  filteredPacks: MedicinePackRecord[];
  packPage: number;
  packsPerPage: number;
  onChangePackPage: (page: number) => void;
  onTransferCustody: (
    serialNumber: string,
    targetStatus: MedicinePackRecord['status'],
    nextCustodian: string,
    nextRole: MedicinePackRecord['custodianRole'],
    actionName: string,
    hubIdOrLocation: string,
    extraNotes?: string
  ) => void;
  onInspectPackQR: (serialNumber: string) => void;
  lastDispensedZkWitness: {
    serial: string;
    rxId: string;
    salt: string;
    commitment: string;
  } | null;
  onOpenZkStudioWithWitness: () => void;
}

const EXPECTED_ROLE_FOR_TAB: Record<SupplyRoleTab, RoleType> = {
  manufacturer: 'MANUFACTURER',
  distributor: 'DISTRIBUTOR',
  pharmacy: 'PHARMACY',
};

const FRIENDLY_ROLE_NAME: Record<RoleType, string> = {
  MANUFACTURER: 'Manufacturer',
  DISTRIBUTOR: 'Distributor',
  PHARMACY: 'Hospital Pharmacy',
  REGULATOR: 'Safety Regulator',
  PATIENT: 'Patient',
  ADMIN: 'Administrator',
};

export const SupplyChainPortal: React.FC<SupplyChainPortalProps> = (props) => {
  const [showBulkPallets, setShowBulkPallets] = useState<boolean>(true);
  const expectedRole = EXPECTED_ROLE_FOR_TAB[props.supplyRoleTab];
  const roleMismatch = props.activeRole !== expectedRole;

  const handleTrackPackOnMap = (serial: string) => {
    props.onSelectTrackedMapPack(serial);
    const mapEl = document.querySelector('[data-testid="supply-chain-transit-map"]');
    if (mapEl) {
      mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="space-y-7">
      {/* Header + 3-Step Flow Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Supply Chain Custody &amp; Transit</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track shipments across the three custody stages: Manufacturing Plant → Cold-Chain
            Carrier → Hospital Pharmacy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex flex-wrap max-w-full p-1 bg-slate-900 border border-slate-800 rounded-lg gap-1">
            <button
              type="button"
              onClick={() => props.onChangeSupplyRoleTab('manufacturer')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                props.supplyRoleTab === 'manufacturer'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              1. Manufacturer
            </button>
            <button
              type="button"
              onClick={() => props.onChangeSupplyRoleTab('distributor')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                props.supplyRoleTab === 'distributor'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              2. Distributor
            </button>
            <button
              type="button"
              onClick={() => props.onChangeSupplyRoleTab('pharmacy')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                props.supplyRoleTab === 'pharmacy'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              3. Pharmacy Dispense
            </button>
          </div>

          <button
            type="button"
            onClick={props.onToggleAutoSwitchSupplyRole}
            title="Switch between strict contract RBAC checks and 1-click guided demo mode"
            className={`px-3 py-2 border rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              props.autoSwitchSupplyRole
                ? 'bg-emerald-950/50 border-emerald-600/70 text-emerald-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {props.autoSwitchSupplyRole ? 'RBAC: Guided Auto-Switch' : 'RBAC: Strict Enforcement'}
          </button>

          <button
            type="button"
            onClick={props.onDownloadAuditCSV}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV Report
          </button>
        </div>
      </div>

      {/* Helpful Role Signer Assistant Banner */}
      {roleMismatch && !props.autoSwitchSupplyRole && (
        <div className="p-4 bg-sky-950/30 border border-sky-700/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-sky-200">
            <UserCheck className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              You are viewing the <strong>{FRIENDLY_ROLE_NAME[expectedRole]}</strong> workspace,
              but your signed-in account is currently{' '}
              <strong>{FRIENDLY_ROLE_NAME[props.activeRole]}</strong> ({props.activeRoleLabel}).
            </span>
          </div>
          <button
            type="button"
            onClick={() => props.onSwitchToRole(expectedRole)}
            className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg whitespace-nowrap shrink-0 flex items-center gap-1.5 self-start sm:self-auto"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Switch to {FRIENDLY_ROLE_NAME[expectedRole]} Role
          </button>
        </div>
      )}

      {props.custodySuccessMsg && (
        <div
          data-testid="custody-success-banner"
          className="p-3.5 bg-emerald-950/35 border border-emerald-700/60 rounded-xl text-xs text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 font-mono">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{props.custodySuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={props.onDismissCustodySuccess}
            className="text-slate-300 hover:text-slate-100 underline self-start sm:self-auto shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {props.custodyErrorMsg && (
        <div className="p-4 bg-rose-950/35 border border-rose-700/60 rounded-xl text-xs text-rose-200">
          {props.custodyErrorMsg}
        </div>
      )}

      {props.liveSseBanner && (
        <div className="p-3 bg-amber-950/35 border border-amber-700/60 rounded-xl text-xs text-amber-200 flex items-center justify-between">
          <span>{props.liveSseBanner}</span>
          <button
            type="button"
            onClick={props.onDismissLiveSseBanner}
            className="text-slate-300 hover:text-slate-100 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Interactive Supply Chain Map */}
      <SupplyChainTransitMap
        hubs={props.logisticsHubs}
        corridors={props.transitCorridors}
        packs={props.packs}
        custodyEvents={props.custodyEvents}
        trackedPackSerial={props.trackedMapPackSerial}
        onSelectTrackedPack={props.onSelectTrackedMapPack}
        onInspectPack={props.onInspectPackQR}
        onRerouteCorridor={props.onRerouteCorridor}
        onClearHubBottleneck={props.onClearHubBottleneck}
      />

      {/* Step Workspace Forms & Tables */}
      {props.supplyRoleTab === 'manufacturer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Register New Batch */}
          <form
            onSubmit={props.onCreateBatch}
            className="lg:col-span-5 min-w-0 bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Register New Medicine Batch
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Creates a new manufacturing lot, digital pack labels, and shipment route.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const suffix = String(Date.now()).slice(-4);
                  props.onChangeNewBatchCode(`BATCH-MRNA-${suffix}`);
                  props.onChangeNewBrandName('Comirnaty mRNA Cold-Chain Vial');
                  props.onChangeNewMinTemp(2);
                  props.onChangeNewMaxTemp(8);
                }}
                className="px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-medium text-emerald-300 whitespace-nowrap shrink-0"
              >
                Fill Sample Batch
              </button>
            </div>

            <div>
              <label htmlFor="batch-code-input" className="block text-xs font-medium text-slate-300 mb-1">
                Batch Number
              </label>
              <input
                id="batch-code-input"
                type="text"
                value={props.newBatchCode}
                onChange={(e) => props.onChangeNewBatchCode(e.target.value)}
                placeholder="e.g. BATCH-MRNA-2026"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono"
              />
            </div>

            <div>
              <label htmlFor="brand-name-input" className="block text-xs font-medium text-slate-300 mb-1">
                Medicine Name
              </label>
              <input
                id="brand-name-input"
                type="text"
                value={props.newBrandName}
                onChange={(e) => props.onChangeNewBrandName(e.target.value)}
                placeholder="e.g. Comirnaty Vaccine Vial"
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="origin-hub-select" className="block text-xs font-medium text-slate-300 mb-1">
                  Origin Facility
                </label>
                <select
                  id="origin-hub-select"
                  value={props.newOriginHubId}
                  onChange={(e) => props.onChangeNewOriginHubId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  {props.logisticsHubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.cityState}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dest-hub-select" className="block text-xs font-medium text-slate-300 mb-1">
                  Destination Hub
                </label>
                <select
                  id="dest-hub-select"
                  value={props.newDestHubId}
                  onChange={(e) => props.onChangeNewDestHubId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  {props.logisticsHubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.cityState}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="min-temp-input" className="block text-xs font-medium text-slate-300 mb-1">
                  Min Safe Temp (°C)
                </label>
                <input
                  id="min-temp-input"
                  type="number"
                  step="0.5"
                  value={props.newMinTemp}
                  onChange={(e) => props.onChangeNewMinTemp(Number(e.target.value))}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono"
                />
              </div>
              <div>
                <label htmlFor="max-temp-input" className="block text-xs font-medium text-slate-300 mb-1">
                  Max Safe Temp (°C)
                </label>
                <input
                  id="max-temp-input"
                  type="number"
                  step="0.5"
                  value={props.newMaxTemp}
                  onChange={(e) => props.onChangeNewMaxTemp(Number(e.target.value))}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono"
                />
              </div>
            </div>

            {props.batchFormError && <p className="text-xs text-rose-400">{props.batchFormError}</p>}
            {props.batchFormSuccess && (
              <p className="text-xs text-emerald-400">{props.batchFormSuccess}</p>
            )}

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-lg transition-colors"
            >
              Register Medicine Batch
            </button>

            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-300">
                Issue Additional Pack Labels
              </div>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <select
                  id="mint-packs-batch-select"
                  name="mintPacksBatchSelect"
                  aria-label="Select Batch to Mint Packs"
                  value={props.selectedBatchForMint}
                  onChange={(e) => props.onChangeSelectedBatchForMint(e.target.value)}
                  className="flex-1 min-w-0 w-full sm:w-auto px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
                >
                  {props.batches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {b.batchCode} ({b.brandName})
                    </option>
                  ))}
                </select>
                <input
                  id="mint-packs-count-input"
                  name="mintPacksCount"
                  type="number"
                  aria-label="Number of packs to mint"
                  min={1}
                  max={20}
                  value={props.mintPackCount}
                  onChange={(e) => props.onChangeMintPackCount(Number(e.target.value))}
                  className="w-16 px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono text-center"
                />
                <button
                  type="button"
                  onClick={props.onMintPacks}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg whitespace-nowrap"
                >
                  + Add {props.mintPackCount} Pack(s)
                </button>
              </div>
            </div>
          </form>

          {/* Pack Inventory & Dispatch */}
          <div className="lg:col-span-7 min-w-0 bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Pack Inventory &amp; Factory Dispatch
                </h2>
                <p className="text-xs text-slate-400">
                  Ship ready medicine packs to an authorized cold-chain carrier.
                </p>
              </div>
              <input
                id="pack-inventory-filter-input"
                name="packFilterQuery"
                type="text"
                aria-label="Filter serialized packs"
                value={props.packFilterQuery}
                onChange={(e) => props.onChangePackFilterQuery(e.target.value)}
                placeholder="Search serial or holder..."
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200"
              />
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="dispatch-carrier-select" className="block text-slate-400 mb-1">
                  Shipping Carrier
                </label>
                <select
                  id="dispatch-carrier-select"
                  value={props.dispatchDistributorName}
                  onChange={(e) => props.onChangeDispatchDistributorName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                >
                  {props.authorizedDistributors.map((d) => (
                    <option key={d.id} value={d.organizationName}>
                      {d.organizationName} ({d.licenseNumber})
                    </option>
                  ))}
                  {!props.authorizedDistributors.some(
                    (d) => d.organizationName === 'Apex Cold-Chain Logistics'
                  ) && (
                    <option value="Apex Cold-Chain Logistics">Apex Cold-Chain Logistics</option>
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="dispatch-hub-select" className="block text-slate-400 mb-1">
                  Destination Cold Hub
                </label>
                <select
                  id="dispatch-hub-select"
                  value={props.dispatchDestinationHubId}
                  onChange={(e) => props.onChangeDispatchDestinationHubId(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
                >
                  {props.logisticsHubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.cityState})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">Pack Serial</th>
                    <th className="py-2.5 px-3">Stage</th>
                    <th className="py-2.5 px-3">Current Holder</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {props.filteredPacks
                    .slice(
                      (props.packPage - 1) * props.packsPerPage,
                      props.packPage * props.packsPerPage
                    )
                    .map((pack) => (
                      <tr key={pack.serialNumber} className="hover:bg-slate-950/60">
                        <td className="py-3 px-3 font-mono font-medium text-slate-100">
                          {pack.serialNumber}
                          <span className="block text-[11px] font-sans font-normal text-slate-400">
                            {pack.lastScannedLocation || 'Manufacturing Plant'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {formatPackStatusLabel(pack.status)}
                        </td>
                        <td className="py-3 px-3 text-slate-300">{pack.currentCustodian}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => handleTrackPackOnMap(pack.serialNumber)}
                              className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 rounded-md whitespace-nowrap"
                            >
                              Track on Map
                            </button>
                            {pack.status === 'MANUFACTURED' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  props.onTransferCustody(
                                    pack.serialNumber,
                                    'IN_TRANSIT',
                                    props.dispatchDistributorName,
                                    'DISTRIBUTOR',
                                    'TRANSFER_DISTRIBUTOR',
                                    props.dispatchDestinationHubId
                                  )
                                }
                                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                              >
                                Ship to Carrier
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => props.onInspectPackQR(pack.serialNumber)}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md whitespace-nowrap"
                              >
                                View Passport
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
              <span>
                Showing{' '}
                {Math.min((props.packPage - 1) * props.packsPerPage + 1, props.filteredPacks.length)}
                –{Math.min(props.packPage * props.packsPerPage, props.filteredPacks.length)} of{' '}
                {props.filteredPacks.length} packs
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={props.packPage <= 1}
                  onClick={() => props.onChangePackPage(Math.max(1, props.packPage - 1))}
                  className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="font-mono">
                  {props.packPage} /{' '}
                  {Math.max(1, Math.ceil(props.filteredPacks.length / props.packsPerPage))}
                </span>
                <button
                  type="button"
                  disabled={props.packPage >= Math.ceil(props.filteredPacks.length / props.packsPerPage)}
                  onClick={() => props.onChangePackPage(props.packPage + 1)}
                  className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {props.supplyRoleTab === 'distributor' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Distributor Fleet &amp; Pharmacy Delivery
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select the receiving hospital pharmacy and confirm the delivery temperature at handover.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="delivery-pharmacy-select" className="block text-slate-400 mb-1">
                Receiving Hospital Pharmacy
              </label>
              <select
                id="delivery-pharmacy-select"
                value={props.deliveryPharmacyName}
                onChange={(e) => props.onChangeDeliveryPharmacyName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
              >
                {props.authorizedPharmacies.map((ph) => (
                  <option key={ph.id} value={ph.organizationName}>
                    {ph.organizationName} ({ph.licenseNumber})
                  </option>
                ))}
                {!props.authorizedPharmacies.some(
                  (ph) => ph.organizationName === 'City Central Hospital Pharmacy'
                ) && (
                  <option value="City Central Hospital Pharmacy">
                    City Central Hospital Pharmacy
                  </option>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="delivery-hub-select" className="block text-slate-400 mb-1">
                Destination Hub
              </label>
              <select
                id="delivery-hub-select"
                value={props.deliveryHubId}
                onChange={(e) => props.onChangeDeliveryHubId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
              >
                {props.logisticsHubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.cityState})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-1 mb-1">
                <label htmlFor="delivery-temp-input" className="block text-slate-400">
                  Delivery Temp (°C)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => props.onChangeDeliveryHandoverTemp('4.4')}
                    className="px-1.5 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono"
                  >
                    4.4°C Safe
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onChangeDeliveryHandoverTemp('-1.5')}
                    className="px-1.5 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[10px] font-mono"
                  >
                    -1.5°C Drop
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onChangeDeliveryHandoverTemp('14.5')}
                    className="px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[10px] font-mono"
                  >
                    14.5°C Spike
                  </button>
                </div>
              </div>
              <input
                id="delivery-temp-input"
                type="number"
                step="0.1"
                value={props.deliveryHandoverTemp}
                onChange={(e) => props.onChangeDeliveryHandoverTemp(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Pack Serial</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3">Carrier / Holder</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {props.packs
                  .filter((p) => p.status === 'IN_TRANSIT' || p.status === 'AT_PHARMACY')
                  .map((pack) => (
                    <tr key={pack.serialNumber} className="hover:bg-slate-950/60">
                      <td className="py-3 px-3 font-mono font-medium text-slate-100">
                        {pack.serialNumber}
                        <span className="block text-[11px] font-sans font-normal text-slate-400">
                          {pack.lastScannedLocation || 'In Transit'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {formatPackStatusLabel(pack.status)}
                      </td>
                      <td className="py-3 px-3 text-slate-300">{pack.currentCustodian}</td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => handleTrackPackOnMap(pack.serialNumber)}
                            className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 rounded-md whitespace-nowrap"
                          >
                            Track on Map
                          </button>
                          {pack.status === 'IN_TRANSIT' ? (
                            <button
                              type="button"
                              onClick={() =>
                                props.onTransferCustody(
                                  pack.serialNumber,
                                  'AT_PHARMACY',
                                  props.deliveryPharmacyName,
                                  'PHARMACY',
                                  'TRANSFER_PHARMACY',
                                  props.deliveryHubId,
                                  `Handover verified at ${props.deliveryHandoverTemp}°C to ${props.deliveryPharmacyName}`
                                )
                              }
                              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                            >
                              Confirm Delivery to Pharmacy
                            </button>
                          ) : (
                            <span className="text-emerald-400 font-medium px-2">Delivered</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {props.supplyRoleTab === 'pharmacy' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Hospital Pharmacy Dispensing Counter
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Enter the prescription reference and dispense packs to patients. Dispensing locks
              the pack permanently so it cannot be resold.
            </p>
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label htmlFor="dispense-rx-input" className="block text-slate-400 mb-1">
                Prescription Reference ID
              </label>
              <input
                id="dispense-rx-input"
                type="text"
                value={props.dispensePatientRef}
                onChange={(e) => props.onChangeDispensePatientRef(e.target.value)}
                placeholder="e.g. RX-2026-88412"
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100 font-mono"
              />
            </div>
            <div>
              <label htmlFor="dispense-clinic-input" className="block text-slate-400 mb-1">
                Pharmacy Location
              </label>
              <input
                id="dispense-clinic-input"
                type="text"
                value={props.dispenseClinicDesk}
                onChange={(e) => props.onChangeDispenseClinicDesk(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
              />
            </div>
          </div>

          {props.lastDispensedZkWitness && (
            <div className="p-4 bg-emerald-950/30 border border-emerald-700/60 rounded-lg space-y-2 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-emerald-300 font-semibold">
                  Private Patient Receipt Issued ({props.lastDispensedZkWitness.serial})
                </span>
                <button
                  type="button"
                  onClick={props.onOpenZkStudioWithWitness}
                  className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded"
                >
                  Open Privacy Verification
                </button>
              </div>
              <div className="text-slate-300 font-mono break-all">
                Prescription: {props.lastDispensedZkWitness.rxId} · Secret Key:{' '}
                <span className="text-amber-300">{props.lastDispensedZkWitness.salt}</span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Pack Serial</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-3">Recorded Scans</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {props.packs
                  .filter((p) => p.status === 'AT_PHARMACY' || p.status === 'DISPENSED')
                  .map((pack) => (
                    <tr key={pack.serialNumber} className="hover:bg-slate-950/60">
                      <td className="py-3 px-3 font-mono font-medium text-slate-100">
                        {pack.serialNumber}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {formatPackStatusLabel(pack.status)}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-slate-300">
                        {pack.scanCount}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => handleTrackPackOnMap(pack.serialNumber)}
                            className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 rounded-md whitespace-nowrap"
                          >
                            Track on Map
                          </button>
                          {pack.status === 'AT_PHARMACY' ? (
                            <button
                              type="button"
                              onClick={() =>
                                props.onTransferCustody(
                                  pack.serialNumber,
                                  'DISPENSED',
                                  `Patient (${props.dispensePatientRef || 'RX-VERIFIED'})`,
                                  'PATIENT',
                                  'DISPENSED_TO_PATIENT',
                                  props.dispenseClinicDesk,
                                  `Dispensed against prescription ${props.dispensePatientRef}`
                                )
                              }
                              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                            >
                              Dispense to Patient
                            </button>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-slate-400">
                                Dispensed ({pack.dispensedAt?.slice(0, 10)})
                              </span>
                              <button
                                type="button"
                                onClick={() => props.onInspectPackQR(pack.serialNumber)}
                                className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 rounded-md whitespace-nowrap font-semibold"
                              >
                                Test Resale Scan
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk Shipping Pallets (SSCC Aggregation) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <button
          type="button"
          onClick={() => setShowBulkPallets((v) => !v)}
          className="w-full flex items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Bulk Shipping Pallets &amp; Group Handover
              </h2>
              <p className="text-xs text-slate-400">
                Bundle multiple individual medicine packs into one tracked pallet (SSCC) for faster
                wholesale transfers.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span>{props.pallets.filter((p) => p.status !== 'UNPACKED').length} active</span>
            {showBulkPallets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showBulkPallets && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start pt-2 border-t border-slate-800">
            <div className="lg:col-span-5 min-w-0 p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3 text-xs">
              <div className="font-semibold text-slate-200">Create New Shipping Pallet</div>
              <select
                id="pallet-batch-select"
                name="palletBatchId"
                aria-label="Pallet Batch Select"
                value={props.palletBatchId}
                onChange={(e) => props.onChangePalletBatchId(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded text-slate-100"
              >
                {props.batches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.batchCode} — {b.brandName}
                  </option>
                ))}
              </select>

              <div className="space-y-1 max-h-28 overflow-y-auto border border-slate-800 rounded p-2 bg-slate-900/60">
                {props.packs
                  .filter(
                    (pk) =>
                      pk.batchId === props.palletBatchId &&
                      (pk.status === 'MANUFACTURED' || pk.status === 'IN_TRANSIT')
                  )
                  .map((pk) => {
                    const checked = props.selectedPalletSerials.includes(pk.serialNumber);
                    const checkboxId = `pallet-pack-${pk.serialNumber}`;
                    return (
                      <label
                        key={pk.serialNumber}
                        htmlFor={checkboxId}
                        className="flex items-center gap-2 font-mono text-[11px] text-slate-200 cursor-pointer"
                      >
                        <input
                          id={checkboxId}
                          name={checkboxId}
                          type="checkbox"
                          checked={checked}
                          onChange={() => props.onTogglePalletSerial(pk.serialNumber)}
                        />
                        {pk.serialNumber} ({formatPackStatusLabel(pk.status)})
                      </label>
                    );
                  })}
              </div>

              <button
                type="button"
                onClick={props.onCommissionPallet}
                className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-lg"
              >
                Bundle Selected Packs ({props.selectedPalletSerials.length})
              </button>
              {props.palletMsg && <p className="text-emerald-400">{props.palletMsg}</p>}
            </div>

            <div className="lg:col-span-7 min-w-0 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-3">Pallet ID / Batch</th>
                    <th className="py-2 px-3">Contents</th>
                    <th className="py-2 px-3">Holder &amp; Stage</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {props.pallets.map((pal) => (
                    <tr key={pal.id} className="hover:bg-slate-950/60">
                      <td className="py-2.5 px-3 font-mono text-slate-100">
                        {pal.sscc}
                        <span className="block text-[11px] text-slate-400">{pal.batchCode}</span>
                      </td>
                      <td className="py-2.5 px-3 text-emerald-300">
                        {pal.childSerials.length} pack(s)
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {pal.currentCustodian}
                        <span className="block text-[11px] text-amber-300">
                          {pal.status === 'AGGREGATED'
                            ? 'Packed at Plant'
                            : pal.status === 'IN_TRANSIT'
                            ? 'In Transit'
                            : 'Unpacked'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1.5">
                        {pal.status === 'AGGREGATED' && (
                          <button
                            type="button"
                            onClick={() =>
                              props.onTransferPallet(
                                pal,
                                props.dispatchDistributorName,
                                'DISTRIBUTOR',
                                props.dispatchDestinationHubId
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded"
                          >
                            Ship Pallet
                          </button>
                        )}
                        {pal.status === 'IN_TRANSIT' && (
                          <button
                            type="button"
                            onClick={() =>
                              props.onTransferPallet(
                                pal,
                                props.deliveryPharmacyName,
                                'PHARMACY',
                                props.deliveryHubId
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded"
                          >
                            Deliver Pallet
                          </button>
                        )}
                        {pal.status !== 'UNPACKED' && (
                          <button
                            type="button"
                            onClick={() => props.onDeaggregatePallet(pal.sscc)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
                          >
                            Unpack
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
