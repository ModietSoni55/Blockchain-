import React from 'react';
import { ShieldCheck, Trash2, UserCheck, ArrowRightLeft } from 'lucide-react';
import {
  BatchRecord,
  MedicinePackRecord,
  PatientAdverseReport,
  RecallProposalRecord,
  RoleType,
  computeRecallBlastRadius,
} from '../utils/sentinelLogic';

interface RegulatorPortalProps {
  activeRole: RoleType;
  activeRoleLabel: string;
  onSwitchToRegulator: (inspectorIndex: 1 | 2) => void;
  regulatorErrorMsg: string;
  regulatorSuccessMsg: string;
  quarantineReasonInput: string;
  onChangeQuarantineReason: (val: string) => void;
  batches: BatchRecord[];
  packs: MedicinePackRecord[];
  recallProposals: RecallProposalRecord[];
  adverseReports: PatientAdverseReport[];
  onToggleQuarantine: (batchId: string, quarantineState: boolean) => void;
  onProposeRecall: (batchId: string) => void;
  onApproveRecallProposal: (proposalId: string) => void;
  onWitnessDestruction: (batchId: string) => void;
}

export const RegulatorPortal: React.FC<RegulatorPortalProps> = ({
  activeRole,
  activeRoleLabel,
  onSwitchToRegulator,
  regulatorErrorMsg,
  regulatorSuccessMsg,
  quarantineReasonInput,
  onChangeQuarantineReason,
  batches,
  packs,
  recallProposals,
  adverseReports,
  onToggleQuarantine,
  onProposeRecall,
  onApproveRecallProposal,
  onWitnessDestruction,
}) => {
  const isRegulator = activeRole === 'REGULATOR';
  const hasPendingProposal = recallProposals.some((p) => !p.executed);

  return (
    <div className="space-y-7">
      <div className="border-b border-slate-800 pb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Recall, Quarantine &amp; Safety Oversight
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Inspectors can freeze suspect batches immediately or run a two-inspector Class I recall
            that locks all packs and alerts patients upon QR scan.
          </p>
        </div>
        <div className="text-xs text-slate-400 shrink-0">
          Signed in as:{' '}
          <span className={isRegulator ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
            {activeRoleLabel}
          </span>
        </div>
      </div>

      {!isRegulator && (
        <div className="p-4 bg-sky-950/30 border border-sky-700/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 text-sky-200">
            <UserCheck className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              Safety holds and recall approvals require an authorized <strong>Safety Regulator</strong>{' '}
              account.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSwitchToRegulator(1)}
            className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 self-start sm:self-auto"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Switch to Regulator Inspector #1
          </button>
        </div>
      )}

      {regulatorErrorMsg && (
        <div className="p-4 bg-rose-950/35 border border-rose-700/60 rounded-xl text-xs text-rose-200">
          {regulatorErrorMsg}
        </div>
      )}
      {regulatorSuccessMsg && (
        <div className="p-4 bg-emerald-950/35 border border-emerald-700/60 rounded-xl text-xs text-emerald-200">
          {regulatorSuccessMsg}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <label htmlFor="quarantine-reason" className="block text-xs font-medium text-slate-300 mb-1.5">
          Official Reason for Hold or Recall
        </label>
        <input
          id="quarantine-reason"
          type="text"
          value={quarantineReasonInput}
          onChange={(e) => onChangeQuarantineReason(e.target.value)}
          className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100"
        />
      </div>

      {/* Registered Batches */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-100 mb-4">Batch Safety Controls</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Batch</th>
                <th className="py-2.5 px-3">Medicine &amp; Manufacturer</th>
                <th className="py-2.5 px-3">Safe Temp</th>
                <th className="py-2.5 px-3">Safety Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {batches.map((b) => (
                <tr key={b.batchId} className="hover:bg-slate-950/60">
                  <td className="py-3.5 px-3 font-mono font-semibold text-slate-100">
                    {b.batchCode}
                  </td>
                  <td className="py-3.5 px-3 text-slate-200">
                    {b.brandName} · <span className="text-slate-400">{b.manufacturerName}</span>
                  </td>
                  <td className="py-3.5 px-3 font-mono text-slate-300">
                    {b.minTemp.toFixed(1)}°C – {b.maxTemp.toFixed(1)}°C
                  </td>
                  <td className="py-3.5 px-3 font-medium">
                    {b.isRecalled ? (
                      <span className="text-rose-400 font-semibold">Recalled (Permanent)</span>
                    ) : b.isQuarantined ? (
                      <span className="text-amber-400 font-semibold">On Safety Hold</span>
                    ) : (
                      <span className="text-emerald-400">Safe &amp; Active</span>
                    )}
                  </td>
                  <td className="py-3.5 px-3 text-right space-x-2">
                    {b.isRecalled ? (
                      <span className="text-rose-400 font-medium">Locked</span>
                    ) : !b.isQuarantined ? (
                      <button
                        type="button"
                        onClick={() => onToggleQuarantine(b.batchId, true)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                      >
                        Place Hold
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleQuarantine(b.batchId, false)}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded-md whitespace-nowrap"
                      >
                        Release Hold
                      </button>
                    )}
                    {!b.isRecalled && (
                      <button
                        type="button"
                        onClick={() => onProposeRecall(b.batchId)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-md whitespace-nowrap"
                      >
                        Start 2-Inspector Recall
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-Inspector Class I Recall Approval Queue */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Two-Inspector Recall Approvals
              </h2>
              <p className="text-xs text-slate-400">
                Prevents unilateral shutdowns: two separate safety inspectors must co-sign before a
                permanent recall takes effect.
              </p>
            </div>
          </div>
          {hasPendingProposal && activeRoleLabel.includes('#1') && (
            <button
              type="button"
              onClick={() => onSwitchToRegulator(2)}
              className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg whitespace-nowrap flex items-center gap-1.5 self-start sm:self-auto"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Switch to Inspector #2 to Co-Sign
            </button>
          )}
        </div>

        {recallProposals.length === 0 ? (
          <p className="text-xs text-slate-400">
            No recall proposals are waiting for approval. Click &ldquo;Start 2-Inspector Recall&rdquo; on any
            batch above to begin.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Batch</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3">Signatures</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {recallProposals.map((prop) => (
                  <tr key={prop.id} className="hover:bg-slate-950/60">
                    <td className="py-3 px-3 font-mono font-semibold text-slate-100">
                      {prop.batchCode}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{prop.reason}</td>
                    <td className="py-3 px-3 font-mono tabular-nums">
                      <span className={prop.executed ? 'text-emerald-400 font-semibold' : 'text-amber-300'}>
                        {prop.approvals.length} of {prop.requiredApprovals} signed
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {prop.executed ? (
                        <span className="text-rose-400 font-semibold">Recall Active</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onApproveRecallProposal(prop.id)}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-md whitespace-nowrap"
                        >
                          Co-Sign &amp; Execute Recall
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recall Impact & Destruction Tracking */}
      {batches.some((b) => b.isRecalled) && (
        <div className="bg-slate-900 border border-rose-800/50 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Recall Impact &amp; Disposal Tracking
              </h2>
              <p className="text-xs text-slate-400">
                Shows where every unit of a recalled batch is located and tracks witnessed disposal.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {batches
              .filter((b) => b.isRecalled)
              .map((b) => {
                const blast = computeRecallBlastRadius(b, packs);
                return (
                  <div
                    key={b.batchId}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-bold text-slate-100">
                          {b.batchCode} — {b.brandName}
                        </span>
                        <span className="block text-xs text-slate-400">
                          Locations involved: {blast.affectedCustodians.join(', ') || 'None'}
                        </span>
                      </div>
                      {blast.destructibleSerials.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onWitnessDestruction(b.batchId)}
                          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-lg whitespace-nowrap shrink-0"
                        >
                          Confirm Disposal ({blast.destructibleSerials.length} Remaining)
                        </button>
                      ) : (
                        <span className="px-3 py-1 bg-slate-900 border border-emerald-700/60 text-emerald-300 text-xs rounded">
                          All Remaining Units Destroyed
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded">
                        <span className="text-slate-400 block">Total Units</span>
                        <span className="text-slate-100 font-bold text-sm font-mono">
                          {blast.totalTrackedPacks}
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded">
                        <span className="text-slate-400 block">At Pharmacies</span>
                        <span className="text-amber-300 font-bold text-sm font-mono">
                          {blast.atPharmacyCount}
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded">
                        <span className="text-slate-400 block">In Transit</span>
                        <span className="text-amber-300 font-bold text-sm font-mono">
                          {blast.inTransitCount}
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded">
                        <span className="text-slate-400 block">Given to Patients</span>
                        <span className="text-rose-400 font-bold text-sm font-mono">
                          {blast.dispensedPatientReceipts}
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded">
                        <span className="text-slate-400 block">Destroyed</span>
                        <span className="text-emerald-400 font-bold text-sm font-mono">
                          {blast.destroyedCount}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Patient & Pharmacist Incident Queue */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Patient &amp; Pharmacist Incident Reports
            </h2>
            <p className="text-xs text-slate-400">
              Submitted directly from QR verification scans in the field.
            </p>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            {adverseReports.length} report(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Pack / Batch</th>
                <th className="py-2.5 px-3">Reported Issue</th>
                <th className="py-2.5 px-3">Location &amp; Notes</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {adverseReports.map((rep) => (
                <tr key={rep.id} className="hover:bg-slate-950/60">
                  <td className="py-3 px-3 font-mono text-slate-100">
                    {rep.serialNumber} · <span className="text-slate-400">{rep.batchCode}</span>
                  </td>
                  <td className="py-3 px-3 text-rose-400 font-medium">
                    {rep.issueCategory
                      .toLowerCase()
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </td>
                  <td className="py-3 px-3 text-slate-300">
                    {rep.locationCity} — {rep.notes}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        const matchingBatch = batches.find((b) => b.batchCode === rep.batchCode);
                        if (matchingBatch) onToggleQuarantine(matchingBatch.batchId, true);
                      }}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold rounded-md whitespace-nowrap"
                    >
                      Hold Batch
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
