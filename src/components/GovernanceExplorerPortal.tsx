import React, { useState } from 'react';
import { RefreshCw, Users, ChevronDown, ChevronUp } from 'lucide-react';
import {
  BatchRecord,
  CommandAuditRecord,
  CustodyEvent,
  MedicinePackRecord,
  ParticipantEntity,
  RoleType,
  ShamirShareRecord,
  TelemetryEvent,
} from '../utils/sentinelLogic';
import { formatCustodyActionLabel } from '../utils/uiLabels';
import { BlockchainCryptographyStudio, EvmStatusInfo } from './BlockchainCryptographyStudio';

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
  onAnchorBatchMerkleRoot: (batchId: string, merkleRoot: string) => void;
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

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            Audit Proofs, Privacy &amp; Network Access
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Verify cryptographic proofs, manage authorized organizations, and review the full audit
            trail.
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
        onAnchorBatchMerkleRoot={props.onAnchorBatchMerkleRoot}
        onAuditBreakGlassShamir={props.onAuditBreakGlassShamir}
      />

      {/* Authorized Organizations Registry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={props.onRegisterParticipant}
          className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Add Authorized Organization
              </h2>
              <p className="text-xs text-slate-400">
                Only safety regulators can grant or revoke network access.
              </p>
            </div>
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
          <h2 className="text-base font-semibold text-slate-100 mb-4">
            Authorized Supply-Chain Organizations
          </h2>
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
                Smart Contract Registry
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
            <h2 className="text-base font-semibold text-slate-100">Recent Custody Audit Trail</h2>
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
