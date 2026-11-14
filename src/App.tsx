import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  QrCode,
  AlertTriangle,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  Wallet,
  Check,
  Database,
  WifiOff,
} from 'lucide-react';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BatchRecord,
  RecallProposalRecord,
  MedicinePackRecord,
  CustodyEvent,
  TelemetryEvent,
  PatientAdverseReport,
  ParticipantEntity,
  LogisticsHubNode,
  TransitRouteCorridor,
  PalletContainerRecord,
  CommandAuditRecord,
  RoleType,
  buildGS1DigitalLink,
  canRoleExecuteAction,
  calculateMeanKineticTemperature,
  evaluatePredictiveColdChain,
  buildHardwareTelemetryDigest,
  detectImpossibleGeographicJump,
  evaluatePackVerification,
  generateMerkleInclusionProof,
  computeEIP712AttestationDigest,
  deriveDeterministicPUFPrint,
  perturbPUFBits,
  PUFMatchResult,
  VerificationResult,
  MANUFACTURER_PUBLIC_ADDRESS,
} from './utils/sentinelLogic';
import {
  INITIAL_BATCHES,
  INITIAL_PACKS,
  INITIAL_CUSTODY_EVENTS,
  INITIAL_TELEMETRY,
  INITIAL_ADVERSE_REPORTS,
  INITIAL_PARTICIPANTS,
  INITIAL_LOGISTICS_HUBS,
  INITIAL_TRANSIT_CORRIDORS,
  INITIAL_PALLETS,
} from './utils/seedData';
import { ROLE_SIGNERS, SandboxSignerProfile, signSentinelCommand } from './utils/commandSigner';
import { formatPackStatusLabel } from './utils/uiLabels';
import {
  OfflineVaultSnapshot,
  QueuedOfflineScan,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
  enqueueOfflineScan,
  listQueuedOfflineScans,
  clearQueuedOfflineScans,
  verifyPackOfflineFromVault,
} from './utils/offlineVault';
import { QRScannerModal } from './components/QRScannerModal';
import { EvmStatusInfo } from './components/BlockchainCryptographyStudio';
import { RedTeamAttackLab } from './components/RedTeamAttackLab';
import { VerifyPortal } from './components/VerifyPortal';
import { SupplyChainPortal } from './components/SupplyChainPortal';
import { ColdChainPortal } from './components/ColdChainPortal';
import { RegulatorPortal } from './components/RegulatorPortal';
import { GovernanceExplorerPortal } from './components/GovernanceExplorerPortal';
import { BlockchainFlowPortal, FlowStageAdvanceAction } from './components/BlockchainFlowPortal';

type ActiveSection = 'flow' | 'verify' | 'supply-chain' | 'cold-chain' | 'regulator' | 'explorer';
type SupplyRoleTab = 'manufacturer' | 'distributor' | 'pharmacy';

interface ScanCheckpointPreset {
  label: string;
  lat: number;
  lon: number;
  elapsedMinutes: number;
}

const SCAN_CHECKPOINTS: Record<string, ScanCheckpointPreset> = {
  BOSTON_CLINIC: {
    label: 'Boston Medical Center, MA',
    lat: 42.3601,
    lon: -71.0589,
    elapsedMinutes: 45,
  },
  CHICAGO_HUB: {
    label: 'Chicago Cold Hub, IL',
    lat: 41.8781,
    lon: -87.6298,
    elapsedMinutes: 180,
  },
  NEWARK_PORT: {
    label: 'Newark Cold Port, NJ',
    lat: 40.7357,
    lon: -74.1724,
    elapsedMinutes: 120,
  },
  LA_CLONE_JUMP: {
    label: 'Los Angeles Port, CA (4-min jump)',
    lat: 34.0522,
    lon: -118.2437,
    elapsedMinutes: 4,
  },
};

const FRIENDLY_SIGNER_SHORT_NAMES: string[] = [
  'Manufacturer',
  'Distributor',
  'Pharmacy',
  'Inspector #1',
  'Inspector #2',
];

const DEV_IOT_GATEWAY_KEY =
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6' as const;

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('flow');
  const [supplyRoleTab, setSupplyRoleTab] = useState<SupplyRoleTab>('manufacturer');

  // Core persistent SQLite ledger state
  const [ledgerVersion, setLedgerVersion] = useState<number>(1);
  const [batches, setBatches] = useState<BatchRecord[]>(INITIAL_BATCHES);
  const [recallProposals, setRecallProposals] = useState<RecallProposalRecord[]>([]);
  const [packs, setPacks] = useState<MedicinePackRecord[]>(INITIAL_PACKS);
  const [pallets, setPallets] = useState<PalletContainerRecord[]>(INITIAL_PALLETS);
  const [custodyEvents, setCustodyEvents] = useState<CustodyEvent[]>(INITIAL_CUSTODY_EVENTS);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>(INITIAL_TELEMETRY);
  const [adverseReports, setAdverseReports] =
    useState<PatientAdverseReport[]>(INITIAL_ADVERSE_REPORTS);
  const [participants, setParticipants] = useState<ParticipantEntity[]>(INITIAL_PARTICIPANTS);
  const [logisticsHubs, setLogisticsHubs] = useState<LogisticsHubNode[]>(INITIAL_LOGISTICS_HUBS);
  const [transitCorridors, setTransitCorridors] = useState<TransitRouteCorridor[]>(
    INITIAL_TRANSIT_CORRIDORS
  );
  const [auditLog, setAuditLog] = useState<CommandAuditRecord[]>([]);
  const [issuerPublicAddress, setIssuerPublicAddress] = useState<string>(
    MANUFACTURER_PUBLIC_ADDRESS
  );
  const [evmStatus, setEvmStatus] = useState<EvmStatusInfo | null>(null);
  const [liveSseBanner, setLiveSseBanner] = useState<string>('');

  // Role Signer & Wallet Dropdown state
  const [signerIndex, setSignerIndex] = useState<number>(0);
  const [injectedWalletAddress, setInjectedWalletAddress] = useState<string | null>(null);
  const [roleMenuOpen, setRoleMenuOpen] = useState<boolean>(false);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState<boolean>(false);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSigner = ROLE_SIGNERS[signerIndex];

  // Verification portal state
  const [scanSerialInput, setScanSerialInput] = useState<string>('SN-PCV20-2026-0001');
  const [lastScannedSerial, setLastScannedSerial] = useState<string>('SN-PCV20-2026-0001');
  const [scanCheckpointKey, setScanCheckpointKey] = useState<string>('BOSTON_CLINIC');
  const [customScanCoords, setCustomScanCoords] = useState<{
    lat: number;
    lon: number;
    label: string;
  } | null>(null);
  const [scanNotification, setScanNotification] = useState<string>('');
  const [impossibleJumpFlag, setImpossibleJumpFlag] = useState<boolean>(false);
  const [signatureTamperedFlag, setSignatureTamperedFlag] = useState<boolean>(false);
  const [pufClonedFlag, setPufClonedFlag] = useState<boolean>(false);
  const [lastPufCheck, setLastPufCheck] = useState<PUFMatchResult | null>(null);
  const [jumpSummaryText, setJumpSummaryText] = useState<string>('');
  const [copiedQrMsg, setCopiedQrMsg] = useState<string>('');
  const [scannerModalOpen, setScannerModalOpen] = useState<boolean>(false);
  const [redTeamOpen, setRedTeamOpen] = useState<boolean>(false);

  // Patient suspicious medicine reporting form state
  const [reportCategory, setReportCategory] =
    useState<PatientAdverseReport['issueCategory']>('SUSPECTED_FAKE_LABEL');
  const [reportLocationCity, setReportLocationCity] = useState<string>(
    'Boston Outpatient Clinic, MA'
  );
  const [reportNotes, setReportNotes] = useState<string>('');
  const [reportSubmittedMsg, setReportSubmittedMsg] = useState<string>('');

  // Manufacturer new batch form state
  const [newBatchCode, setNewBatchCode] = useState<string>('');
  const [newBrandName, setNewBrandName] = useState<string>('');
  const [newGenericName, setNewGenericName] = useState<string>('');
  const [newProductCode] = useState<string>('NDC-0069-8850-01');
  const [newTotalPacks] = useState<number>(100);
  const [newMinTemp, setNewMinTemp] = useState<number>(2.0);
  const [newMaxTemp, setNewMaxTemp] = useState<number>(8.0);
  const [newOriginHubId, setNewOriginHubId] = useState<string>('hub-kalamazoo');
  const [newDestHubId, setNewDestHubId] = useState<string>('hub-chicago');
  const [batchFormError, setBatchFormError] = useState<string>('');
  const [batchFormSuccess, setBatchFormSuccess] = useState<string>('');

  // Pack serialization & filtering state
  const [selectedBatchForMint, setSelectedBatchForMint] = useState<string>(
    INITIAL_BATCHES[0].batchId
  );
  const [mintPackCount, setMintPackCount] = useState<number>(2);
  const [packFilterQuery, setPackFilterQuery] = useState<string>('');

  // Configurable custody transfer parameters
  const [dispatchDistributorName, setDispatchDistributorName] = useState<string>(
    'Apex Cold-Chain Logistics'
  );
  const [dispatchDestinationHubId, setDispatchDestinationHubId] = useState<string>('hub-chicago');
  const [deliveryPharmacyName, setDeliveryPharmacyName] = useState<string>(
    'City Central Hospital Pharmacy'
  );
  const [deliveryHubId, setDeliveryHubId] = useState<string>('hub-boston');
  const [deliveryHandoverTemp, setDeliveryHandoverTemp] = useState<string>('4.4');
  const [dispensePatientRef, setDispensePatientRef] = useState<string>('RX-2026-88412');
  const [dispenseClinicDesk, setDispenseClinicDesk] = useState<string>(
    'City Central Outpatient Pharmacy Desk #2, Boston, MA'
  );

  // Cold-chain IoT simulator form state
  const [selectedBatchForIoT, setSelectedBatchForIoT] = useState<string>(
    INITIAL_BATCHES[0].batchId
  );
  const [selectedHubForIoT, setSelectedHubForIoT] = useState<string>('hub-newark');
  const [simTemperature, setSimTemperature] = useState<string>('4.6');
  const [simLocation, setSimLocation] = useState<string>('Newark I-95 Cold Port, NJ');
  const [iotFeedback, setIotFeedback] = useState<string>('');

  // Regulator quarantine reason & RBAC status feedback
  const [quarantineReasonInput, setQuarantineReasonInput] = useState<string>(
    'Mandatory cold-chain excursion safety hold ordered by State Drug Inspector'
  );
  const [custodyErrorMsg, setCustodyErrorMsg] = useState<string>('');
  const [custodySuccessMsg, setCustodySuccessMsg] = useState<string>('');
  const [autoSwitchSupplyRole, setAutoSwitchSupplyRole] = useState<boolean>(false);
  const [regulatorErrorMsg, setRegulatorErrorMsg] = useState<string>('');
  const [regulatorSuccessMsg, setRegulatorSuccessMsg] = useState<string>('');

  // Admin participant registration state
  const [newOrgName, setNewOrgName] = useState<string>('');
  const [newOrgRole, setNewOrgRole] = useState<RoleType>('DISTRIBUTOR');
  const [newOrgWallet, setNewOrgWallet] = useState<string>('');
  const [newOrgLicense, setNewOrgLicense] = useState<string>('');
  const [newOrgRegion] = useState<string>('New York Metro Hub, NY');
  const [participantMsg, setParticipantMsg] = useState<string>('');

  const [lastVerifyMeta, setLastVerifyMeta] = useState<{
    signatureMethod: string;
    inferenceEngine: string;
    verifiedOffline: boolean;
    merkleRootMatched?: boolean;
  }>({
    signatureMethod: 'ECDSA Secp256k1',
    inferenceEngine: 'Risk Scoring Model',
    verifiedOffline: false,
  });
  const [offlineResultOverride, setOfflineResultOverride] = useState<VerificationResult | null>(
    null
  );

  // Offline Edge Vault (IndexedDB) state
  const [offlineVault, setOfflineVault] = useState<OfflineVaultSnapshot | null>(null);
  const [queuedOfflineScans, setQueuedOfflineScans] = useState<QueuedOfflineScan[]>([]);
  const [simulatedOfflineMode, setSimulatedOfflineMode] = useState<boolean>(false);

  // Supply Chain Pagination, Pallet Aggregation & ZK Claim Receipt state
  const [packPage, setPackPage] = useState<number>(1);
  const PACKS_PER_PAGE = 6;
  const [selectedPalletSerials, setSelectedPalletSerials] = useState<string[]>([
    'SN-PCV20-2026-0004',
  ]);
  const [palletBatchId, setPalletBatchId] = useState<string>(INITIAL_BATCHES[0].batchId);
  const [palletMsg, setPalletMsg] = useState<string>('');
  const [trackedMapPackSerial, setTrackedMapPackSerial] = useState<string | null>(null);
  const [lastDispensedZkWitness, setLastDispensedZkWitness] = useState<{
    serial: string;
    rxId: string;
    salt: string;
    commitment: string;
  } | null>(null);
  const [prefillZkWitness, setPrefillZkWitness] = useState<{
    serial: string;
    rxId: string;
    salt: string;
  } | null>(null);

  const [lastHardwarePacket, setLastHardwarePacket] = useState<Record<string, unknown> | null>(
    null
  );

  // Close role & mode dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setRoleMenuOpen(false);
      }
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const applyServerState = (data: Record<string, unknown>) => {
    if (typeof data.version === 'number') setLedgerVersion(data.version);
    if (Array.isArray(data.batches) && data.batches.length > 0) {
      setBatches(data.batches as BatchRecord[]);
    }
    if (Array.isArray(data.recallProposals)) {
      setRecallProposals(data.recallProposals as RecallProposalRecord[]);
    }
    if (Array.isArray(data.packs) && data.packs.length > 0) {
      setPacks(data.packs as MedicinePackRecord[]);
    }
    if (Array.isArray(data.pallets)) {
      setPallets(data.pallets as PalletContainerRecord[]);
    }
    if (Array.isArray(data.custodyEvents)) {
      setCustodyEvents(data.custodyEvents as CustodyEvent[]);
    }
    if (Array.isArray(data.telemetry)) {
      setTelemetry(data.telemetry as TelemetryEvent[]);
    }
    if (Array.isArray(data.adverseReports)) {
      setAdverseReports(data.adverseReports as PatientAdverseReport[]);
    }
    if (Array.isArray(data.participants)) {
      setParticipants(data.participants as ParticipantEntity[]);
    }
    if (Array.isArray(data.logisticsHubs)) {
      setLogisticsHubs(data.logisticsHubs as LogisticsHubNode[]);
    }
    if (Array.isArray(data.transitCorridors)) {
      setTransitCorridors(data.transitCorridors as TransitRouteCorridor[]);
    }
    if (Array.isArray(data.auditLog)) {
      setAuditLog(data.auditLog as CommandAuditRecord[]);
    }
  };

  const refreshFullLedger = async () => {
    try {
      const res = await fetch('/api/ledger');
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        applyServerState(data);
      }
    } catch {
      // Ignore transient offline error
    }
  };

  const syncOfflineEdgeVault = async () => {
    try {
      const res = await fetch('/api/offline-snapshot');
      if (!res.ok) return;
      const snap = (await res.json()) as OfflineVaultSnapshot;
      await saveOfflineSnapshot(snap);
      setOfflineVault(snap);
      setScanNotification(
        `Offline cache refreshed (${snap.batches.length} medicine batches saved for offline checks).`
      );
    } catch {
      setScanNotification('Unable to reach server to refresh offline cache.');
    }
  };

  const probeEvmStatus = async () => {
    try {
      const res = await fetch('/api/evm/status');
      if (res.ok) {
        setEvmStatus((await res.json()) as EvmStatusInfo);
      }
    } catch {
      // Ignore probe error
    }
  };

  useEffect(() => {
    refreshFullLedger();
    probeEvmStatus();
    fetch('/api/crypto/public-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.issuerPublicAddress) setIssuerPublicAddress(d.issuerPublicAddress);
      })
      .catch(() => {});

    loadOfflineSnapshot().then((existing) => {
      if (existing) {
        setOfflineVault(existing);
      } else {
        syncOfflineEdgeVault();
      }
    });
    listQueuedOfflineScans().then(setQueuedOfflineScans);

    const es = new EventSource('/api/events/stream');
    es.addEventListener('ledger_updated', () => {
      refreshFullLedger();
    });
    es.addEventListener('excursion_alert', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data);
        setLiveSseBanner(
          `Live Temperature Alert: Overheating detected (${parsed.temperature ?? 'Breach'}°C)`
        );
      } catch {
        setLiveSseBanner('Live Temperature Alert pushed from sensor monitor.');
      }
      refreshFullLedger();
    });
    es.addEventListener('recall_executed', (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data);
        setLiveSseBanner(`Class I Recall Executed: ${parsed.summary || ''}`);
      } catch {
        setLiveSseBanner('Class I Recall Executed.');
      }
      refreshFullLedger();
    });

    return () => {
      es.close();
    };
  }, []);

  const executeSignedCommand = async <T extends Record<string, unknown>>(
    action: string,
    targetId: string,
    payload: T,
    options?: { signerOverride?: SandboxSignerProfile; clearInjectedWallet?: boolean }
  ): Promise<Record<string, unknown>> => {
    const usedSigner = options?.signerOverride || activeSigner;
    const usedInjected = options?.clearInjectedWallet ? null : injectedWalletAddress;
    const signedEnvelope = await signSentinelCommand({
      action,
      targetId,
      payload,
      signer: usedSigner,
      injectedWalletAddress: usedInjected,
    });
    const res = await fetch(`/api/commands/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedEnvelope),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !data.ok) {
      if (res.status === 409) {
        await refreshFullLedger();
      }
      throw new Error(String(data.error || `Command ${action} failed (HTTP ${res.status})`));
    }
    if (data.state) {
      applyServerState(data.state as Record<string, unknown>);
    }
    return data;
  };

  const handleSelectSignerIndex = (idx: number) => {
    setInjectedWalletAddress(null);
    setCustodyErrorMsg('');
    setCustodySuccessMsg('');
    setRegulatorErrorMsg('');
    setSignerIndex(idx);
    setRoleMenuOpen(false);
    const nextRole = ROLE_SIGNERS[idx].role;
    if (nextRole === 'MANUFACTURER') setSupplyRoleTab('manufacturer');
    if (nextRole === 'DISTRIBUTOR') setSupplyRoleTab('distributor');
    if (nextRole === 'PHARMACY') setSupplyRoleTab('pharmacy');
  };

  const handleSwitchToRole = (targetRole: RoleType, regulatorInspector: 1 | 2 = 1) => {
    const idx =
      targetRole === 'REGULATOR' && regulatorInspector === 2
        ? ROLE_SIGNERS.findIndex((s) => s.role === 'REGULATOR' && s.label.includes('#2'))
        : ROLE_SIGNERS.findIndex((s) => s.role === targetRole);
    if (idx >= 0) {
      handleSelectSignerIndex(idx);
    }
  };

  const handleConnectBrowserWallet = async () => {
    const eth = (
      window as unknown as {
        ethereum?: { request: (args: { method: string }) => Promise<string[]> };
      }
    ).ethereum;
    if (eth) {
      try {
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          setInjectedWalletAddress(accounts[0]);
          setRoleMenuOpen(false);
        }
      } catch {
        // User declined or unavailable
      }
    }
    setRoleMenuOpen(false);
  };

  const handleUseBrowserGPS = () => {
    if (!('geolocation' in navigator)) {
      setScanNotification('Device GPS unavailable; using selected checkpoint.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 10000) / 10000;
        const lon = Math.round(pos.coords.longitude * 10000) / 10000;
        setCustomScanCoords({
          lat,
          lon,
          label: `Live GPS (${lat}, ${lon})`,
        });
        setScanNotification(`Using live device GPS (${lat}, ${lon}) for verification.`);
      },
      () => {
        setScanNotification('GPS permission unavailable; using selected location checkpoint.');
      },
      { timeout: 4000 }
    );
  };

  const handleVerifySerial = async (
    rawInputToScan: string,
    simulateGeoCloneJump = false,
    simulatePufClone = false
  ) => {
    const trimmed = rawInputToScan.trim();
    if (!trimmed) return;
    setScanSerialInput(trimmed);
    setReportSubmittedMsg('');
    setCopiedQrMsg('');
    setOfflineResultOverride(null);

    const checkpoint = simulateGeoCloneJump
      ? SCAN_CHECKPOINTS.LA_CLONE_JUMP
      : customScanCoords
      ? {
          label: customScanCoords.label,
          lat: customScanCoords.lat,
          lon: customScanCoords.lon,
          elapsedMinutes: 15,
        }
      : SCAN_CHECKPOINTS[scanCheckpointKey] || SCAN_CHECKPOINTS.BOSTON_CLINIC;

    let scannedPufHex: string | undefined;
    if (simulatePufClone) {
      const matchedPack =
        packs.find((p) => p.serialNumber.toLowerCase() === trimmed.toLowerCase()) || packs[0];
      const basePuf =
        matchedPack?.pufSealHash ||
        deriveDeterministicPUFPrint(
          matchedPack?.serialNumber || trimmed,
          matchedPack?.batchId || batches[0]?.batchId || '0x0'
        );
      scannedPufHex = perturbPUFBits(basePuf, 108);
    }

    const useOffline = simulatedOfflineMode || !navigator.onLine;
    if (useOffline && offlineVault) {
      const offlineEval = await verifyPackOfflineFromVault(trimmed, offlineVault, scannedPufHex);
      setLastScannedSerial(offlineEval.result.pack?.serialNumber || trimmed);
      setOfflineResultOverride(offlineEval.result);
      setSignatureTamperedFlag(offlineEval.result.outcome === 'TAMPERED_SIGNATURE');
      setPufClonedFlag(offlineEval.result.outcome === 'PHOTOCOPY_CLONE_DETECTED');
      setLastPufCheck(offlineEval.pufCheck || null);
      setImpossibleJumpFlag(false);
      setJumpSummaryText('');
      setLastVerifyMeta({
        signatureMethod: offlineEval.ecdsaSignerVerified ? 'ECDSA Secp256k1 (Offline)' : 'Offline Cache',
        inferenceEngine: 'Offline Merkle Check',
        verifiedOffline: true,
        merkleRootMatched: offlineEval.merkleRootMatched,
      });

      const queued: QueuedOfflineScan = {
        id: `qscan-${Date.now()}`,
        rawInput: trimmed,
        locationLabel: checkpoint.label,
        scannedAt: new Date().toISOString(),
        localOutcome: offlineEval.result.outcome,
      };
      await enqueueOfflineScan(queued);
      setQueuedOfflineScans(await listQueuedOfflineScans());
      setScanNotification(
        `Verified offline against cached safety ledger. Scan saved to upload when back online.`
      );
      return;
    }

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput: trimmed,
          scanLat: checkpoint.lat,
          scanLon: checkpoint.lon,
          scanLocation: checkpoint.label,
          elapsedMinutes: checkpoint.elapsedMinutes,
          ...(scannedPufHex ? { scannedPufHex } : {}),
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json()) as { error?: string };
        setScanNotification(errBody.error || `Verification error (HTTP ${res.status})`);
        return;
      }

      const data = (await res.json()) as VerificationResult & {
        signatureMethod?: string;
        inferenceEngine?: string;
        pufCheck?: PUFMatchResult;
        state?: Record<string, unknown>;
      };

      if (data.state) {
        applyServerState(data.state);
      }

      const targetSerial = data.pack?.serialNumber || trimmed;
      setLastScannedSerial(targetSerial);

      const isSigTampered = data.outcome === 'TAMPERED_SIGNATURE';
      const isPufCloned = data.outcome === 'PHOTOCOPY_CLONE_DETECTED';
      const isJump =
        simulateGeoCloneJump ||
        Boolean(data.aiAssessment?.reason?.includes('velocity')) ||
        Boolean(data.message?.includes('Geo-velocity'));

      setSignatureTamperedFlag(isSigTampered);
      setPufClonedFlag(isPufCloned);
      setLastPufCheck(data.pufCheck ?? null);
      setImpossibleJumpFlag(isJump);

      if (isPufCloned && data.pufCheck) {
        setScanNotification(
          `Photocopy clone blocked: Optical seal drifted ${data.pufCheck.bitDrift}/256 bits (${data.pufCheck.similarityPct}% match).`
        );
        setJumpSummaryText('');
      } else if (isJump && data.pack) {
        const jump = detectImpossibleGeographicJump(
          42.3601,
          -71.0589,
          checkpoint.lat,
          checkpoint.lon,
          checkpoint.elapsedMinutes
        );
        const detail = `Impossible travel detected: scanned at ${checkpoint.label} (${jump.distanceKm} km away in just ${checkpoint.elapsedMinutes} mins — ${jump.velocityKmh} km/h).`;
        setJumpSummaryText(detail);
        setScanNotification(detail);
      } else {
        setJumpSummaryText('');
        setScanNotification(
          isSigTampered
            ? `Forged QR signature blocked for ${targetSerial}.`
            : `Checked ${targetSerial} at ${checkpoint.label}.`
        );
      }

      setLastVerifyMeta({
        signatureMethod: data.signatureMethod || 'ECDSA Secp256k1',
        inferenceEngine: data.inferenceEngine || 'Risk Scoring Model',
        verifiedOffline: false,
      });
    } catch {
      if (offlineVault) {
        const offlineEval = await verifyPackOfflineFromVault(trimmed, offlineVault);
        setOfflineResultOverride(offlineEval.result);
        setScanNotification(`Network unreachable; verified using offline cache.`);
      }
    }
  };

  const handleFlushQueuedOfflineScans = async () => {
    if (queuedOfflineScans.length === 0) return;
    let flushed = 0;
    for (const q of queuedOfflineScans) {
      try {
        const res = await fetch('/api/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawInput: q.rawInput,
            scanLocation: `${q.locationLabel} (Synced Offline Scan)`,
          }),
        });
        if (res.ok) flushed++;
      } catch {
        break;
      }
    }
    if (flushed > 0) {
      await clearQueuedOfflineScans();
      setQueuedOfflineScans([]);
      await refreshFullLedger();
      setScanNotification(`Uploaded ${flushed} offline scan(s) to the central ledger.`);
    }
  };

  const activeVerification = useMemo(() => {
    if (offlineResultOverride) return offlineResultOverride;
    const pack = packs.find(
      (p) => p.serialNumber.toLowerCase() === lastScannedSerial.toLowerCase()
    );
    const batch = pack ? batches.find((b) => b.batchId === pack.batchId) : undefined;
    const packCustody = pack
      ? custodyEvents.filter((c) => c.serialHash === pack.serialHash || c.serialHash === pack.batchId)
      : [];
    const batchTelemetry = batch ? telemetry.filter((t) => t.batchId === batch.batchId) : [];

    return evaluatePackVerification(
      pack,
      batch,
      packCustody,
      batchTelemetry,
      new Date().toISOString(),
      impossibleJumpFlag,
      signatureTamperedFlag,
      pufClonedFlag
    );
  }, [
    offlineResultOverride,
    packs,
    batches,
    custodyEvents,
    telemetry,
    lastScannedSerial,
    impossibleJumpFlag,
    signatureTamperedFlag,
    pufClonedFlag,
  ]);

  const activePackCryptoProof = useMemo(() => {
    if (!activeVerification.pack || !activeVerification.batch) return null;
    const siblingPacks = packs.filter((p) => p.batchId === activeVerification.batch?.batchId);
    const merkleProof = generateMerkleInclusionProof(
      activeVerification.pack.serialNumber,
      siblingPacks,
      activeVerification.batch.expiresAt
    );
    const eip712 = computeEIP712AttestationDigest({
      serialNumber: activeVerification.pack.serialNumber,
      serialHash: activeVerification.pack.serialHash,
      batchId: activeVerification.pack.batchId,
      expiresAt: activeVerification.batch.expiresAt,
      nonce: activeVerification.pack.nonce,
      status: activeVerification.pack.status,
      chainId: 31337,
    });
    return { merkleProof, eip712 };
  }, [activeVerification, packs]);

  const handleCopySignedQRPayload = () => {
    if (!activeVerification.pack || !activeVerification.batch) return;
    const payload = JSON.stringify({
      serialNumber: activeVerification.pack.serialNumber,
      batchId: activeVerification.pack.batchId,
      expiresAt: activeVerification.batch.expiresAt,
      nonce: activeVerification.pack.nonce,
      signature: activeVerification.pack.signature,
    });
    setScanSerialInput(payload);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(payload).catch(() => {});
    }
    setCopiedQrMsg('Copied signed QR JSON data into the scan box & clipboard.');
  };

  const handleLoadGS1DigitalLink = () => {
    if (!activeVerification.pack || !activeVerification.batch) return;
    const gs1Link = buildGS1DigitalLink(
      activeVerification.batch.productCode,
      activeVerification.pack.serialNumber,
      activeVerification.pack.signature
    );
    setScanSerialInput(gs1Link);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(gs1Link).catch(() => {});
    }
    setCopiedQrMsg('Loaded standard GS1 Digital Link into the scan box & clipboard.');
  };

  const handleTestTamperedQR = () => {
    if (!activeVerification.pack) return;
    const tamperedInput = `${activeVerification.pack.serialNumber}:0xdeadbeef0000111122223333444455556666777788889999aaaabbbbccccdddd`;
    handleVerifySerial(tamperedInput, false);
  };

  const handleReportSuspiciousPack = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSerial = activeVerification.pack?.serialNumber || lastScannedSerial || 'UNKNOWN';
    const targetBatchCode = activeVerification.batch?.batchCode || 'UNREGISTERED';
    try {
      const res = await executeSignedCommand('adverse-report', targetSerial, {
        serialNumber: targetSerial,
        batchCode: targetBatchCode,
        issueCategory: reportCategory,
        locationCity: reportLocationCity.trim() || 'Anonymous Patient Submission',
        notes:
          reportNotes.trim() ||
          `Flagged during QR verification (${activeVerification.outcome})`,
      });
      const created = res.newReport as PatientAdverseReport | undefined;
      setReportNotes('');
      setReportSubmittedMsg(
        `Report #${(created?.id || String(Date.now())).slice(-4)} sent directly to safety regulators.`
      );
    } catch (err) {
      setReportSubmittedMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchFormError('');
    setBatchFormSuccess('');

    const rbac = canRoleExecuteAction(activeSigner.role, 'MINT_BATCH');
    if (!rbac.allowed) {
      setBatchFormError(
        rbac.reason || `Please switch your role to Manufacturer to register new batches.`
      );
      return;
    }

    try {
      const res = await executeSignedCommand('mint-batch', newBatchCode.trim(), {
        batchCode: newBatchCode.trim(),
        brandName: newBrandName.trim(),
        genericName: newGenericName.trim(),
        productCode: newProductCode.trim(),
        totalPacks: Number(newTotalPacks) || 100,
        minTemp: Number(newMinTemp),
        maxTemp: Number(newMaxTemp),
        originHubId: newOriginHubId,
        destHubId: newDestHubId,
        carrierName: dispatchDistributorName,
      });
      const createdBatch = res.createdBatch as BatchRecord | undefined;
      const firstSerial = String(res.firstSerial || '');
      if (createdBatch) {
        setSelectedBatchForMint(createdBatch.batchId);
        setSelectedBatchForIoT(createdBatch.batchId);
      }
      if (firstSerial) {
        setTrackedMapPackSerial(firstSerial);
      }
      setNewBatchCode('');
      setNewBrandName('');
      setNewGenericName('');
      setBatchFormSuccess(
        `Created batch ${createdBatch?.batchCode || ''} and sealed initial pack ${firstSerial}.`
      );
    } catch (err) {
      setBatchFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleMintPacks = async () => {
    setBatchFormError('');
    setBatchFormSuccess('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'MINT_BATCH');
    if (!rbac.allowed) {
      setBatchFormError(
        rbac.reason || `Please switch your role to Manufacturer to issue pack labels.`
      );
      return;
    }
    try {
      const res = await executeSignedCommand('mint-packs', selectedBatchForMint, {
        batchId: selectedBatchForMint,
        count: Math.min(Math.max(Number(mintPackCount) || 1, 1), 20),
        originHubId: newOriginHubId,
      });
      if (res.firstSerial) {
        setTrackedMapPackSerial(String(res.firstSerial));
      }
      setBatchFormSuccess(
        `Issued ${String(res.count || mintPackCount)} new signed pack(s) for ${String(res.batchCode || '')}.`
      );
    } catch (err) {
      setBatchFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTransferCustody = async (
    serialNumber: string,
    targetStatus: MedicinePackRecord['status'],
    nextCustodian: string,
    nextRole: MedicinePackRecord['custodianRole'],
    actionName: string,
    hubIdOrLocation: string,
    extraNotes?: string
  ) => {
    setCustodyErrorMsg('');
    setCustodySuccessMsg('');
    const requiredRbacAction =
      actionName === 'TRANSFER_DISTRIBUTOR'
        ? 'TRANSFER_DISTRIBUTOR'
        : actionName === 'TRANSFER_PHARMACY'
        ? 'TRANSFER_PHARMACY'
        : 'DISPENSE_PATIENT';

    const targetSignerIdx =
      actionName === 'TRANSFER_DISTRIBUTOR' ? 0 : actionName === 'TRANSFER_PHARMACY' ? 1 : 2;

    const rbac = canRoleExecuteAction(activeSigner.role, requiredRbacAction);
    let signerOverride: SandboxSignerProfile | undefined;
    let usedSigner = activeSigner;

    if (!rbac.allowed) {
      if (autoSwitchSupplyRole) {
        signerOverride = ROLE_SIGNERS[targetSignerIdx];
        usedSigner = signerOverride;
        handleSelectSignerIndex(targetSignerIdx);
      } else {
        setCustodyErrorMsg(
          rbac.reason || `Switch to the ${rbac.requiredRole} role to perform this handover.`
        );
        return;
      }
    }

    try {
      const res = await executeSignedCommand(
        'transfer-custody',
        serialNumber,
        {
          serialNumber,
          targetStatus,
          nextCustodian,
          nextRole,
          actionName,
          hubIdOrLocation,
          extraNotes,
          prescriptionRef: dispensePatientRef || 'RX-2026-88412',
          handoverTemp:
            actionName === 'TRANSFER_PHARMACY' ? parseFloat(deliveryHandoverTemp) : undefined,
        },
        signerOverride ? { signerOverride, clearInjectedWallet: true } : undefined
      );

      setTrackedMapPackSerial(serialNumber);
      const txShort =
        typeof res.txHash === 'string' && res.txHash.length > 14
          ? `${res.txHash.slice(0, 14)}...`
          : String(res.txHash || 'sealed');
      const locLabel =
        typeof res.locationLabel === 'string' && res.locationLabel
          ? res.locationLabel
          : hubIdOrLocation;
      setCustodySuccessMsg(
        `${serialNumber} → ${formatPackStatusLabel(targetStatus)} (${locLabel}) · Signed by ${usedSigner.label} (${usedSigner.address.slice(0, 6)}...${usedSigner.address.slice(-4)}) · Tx ${txShort}`
      );
      if (targetStatus === 'DISPENSED' && res.zkSaltIssued && res.zkReceiptCommitment) {
        setLastDispensedZkWitness({
          serial: serialNumber,
          rxId: String(res.rxRef || dispensePatientRef || 'RX-2026-88412'),
          salt: String(res.zkSaltIssued),
          commitment: String(res.zkReceiptCommitment),
        });
      }
    } catch (err) {
      setCustodyErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAdvanceFlowStage = async (serialNumber: string, action: FlowStageAdvanceAction) => {
    const stageConfig =
      action === 'SHIP_TO_DISTRIBUTOR'
        ? {
            signerIdx: 0,
            targetStatus: 'IN_TRANSIT' as const,
            nextCustodian: dispatchDistributorName,
            nextRole: 'DISTRIBUTOR' as const,
            actionName: 'TRANSFER_DISTRIBUTOR',
            hubIdOrLocation: dispatchDestinationHubId,
            handoverTemp: undefined,
          }
        : action === 'DELIVER_TO_PHARMACY'
        ? {
            signerIdx: 1,
            targetStatus: 'AT_PHARMACY' as const,
            nextCustodian: deliveryPharmacyName,
            nextRole: 'PHARMACY' as const,
            actionName: 'TRANSFER_PHARMACY',
            hubIdOrLocation: deliveryHubId,
            handoverTemp: parseFloat(deliveryHandoverTemp) || 4.4,
          }
        : {
            signerIdx: 2,
            targetStatus: 'DISPENSED' as const,
            nextCustodian: `Patient (${dispensePatientRef || 'RX-2026-88412'})`,
            nextRole: 'PATIENT' as const,
            actionName: 'DISPENSED_TO_PATIENT',
            hubIdOrLocation: dispenseClinicDesk,
            handoverTemp: undefined,
          };

    const roleSigner = ROLE_SIGNERS[stageConfig.signerIdx];
    handleSelectSignerIndex(stageConfig.signerIdx);

    const signedEnvelope = await signSentinelCommand({
      action: 'transfer-custody',
      targetId: serialNumber,
      payload: {
        serialNumber,
        targetStatus: stageConfig.targetStatus,
        nextCustodian: stageConfig.nextCustodian,
        nextRole: stageConfig.nextRole,
        actionName: stageConfig.actionName,
        hubIdOrLocation: stageConfig.hubIdOrLocation,
        prescriptionRef: dispensePatientRef || 'RX-2026-88412',
        handoverTemp: stageConfig.handoverTemp,
      },
      signer: roleSigner,
      injectedWalletAddress: null,
    });

    const res = await fetch('/api/commands/transfer-custody', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedEnvelope),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !data.ok) {
      if (res.status === 409) {
        await refreshFullLedger();
      }
      throw new Error(String(data.error || `Stage advance failed (HTTP ${res.status})`));
    }
    if (data.state) {
      applyServerState(data.state as Record<string, unknown>);
    }
    setTrackedMapPackSerial(serialNumber);
    if (
      stageConfig.targetStatus === 'DISPENSED' &&
      data.zkSaltIssued &&
      data.zkReceiptCommitment
    ) {
      const rxId = String(data.rxRef || dispensePatientRef || 'RX-2026-88412');
      const salt = String(data.zkSaltIssued);
      setLastDispensedZkWitness({
        serial: serialNumber,
        rxId,
        salt,
        commitment: String(data.zkReceiptCommitment),
      });
      setPrefillZkWitness({ serial: serialNumber, rxId, salt });
    }
  };

  const handleCommissionPallet = async () => {
    setCustodyErrorMsg('');
    setPalletMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'COMMISSION_PALLET');
    if (!rbac.allowed) {
      setCustodyErrorMsg(rbac.reason || 'Switch to Manufacturer role to bundle pallets.');
      return;
    }
    try {
      const res = await executeSignedCommand('commission-pallet', palletBatchId, {
        batchId: palletBatchId,
        childSerials: selectedPalletSerials,
      });
      const pal = res.pallet as PalletContainerRecord | undefined;
      setPalletMsg(
        `Created shipping pallet ${pal?.sscc || ''} with ${pal?.childSerials.length || 0} pack(s).`
      );
    } catch (err) {
      setCustodyErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTransferPallet = async (
    pallet: PalletContainerRecord,
    nextCustodian: string,
    nextRole: RoleType,
    hubId: string
  ) => {
    setCustodyErrorMsg('');
    setPalletMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'TRANSFER_PALLET');
    if (!rbac.allowed) {
      setCustodyErrorMsg(rbac.reason || 'Active account lacks permission for this pallet transfer.');
      return;
    }
    try {
      await executeSignedCommand('transfer-pallet', pallet.sscc, {
        sscc: pallet.sscc,
        nextCustodian,
        nextRole,
        hubId,
      });
      setPalletMsg(
        `Transferred pallet ${pallet.sscc} (${pallet.childSerials.length} packs) to ${nextCustodian}.`
      );
    } catch (err) {
      setCustodyErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeaggregatePallet = async (sscc: string) => {
    setCustodyErrorMsg('');
    setPalletMsg('');
    try {
      await executeSignedCommand('deaggregate-pallet', sscc, { sscc });
      setPalletMsg(`Unpacked pallet ${sscc}; individual packs are ready for unit handling.`);
    } catch (err) {
      setCustodyErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownloadAuditCSV = () => {
    const headers = ['SerialNumber', 'BatchId', 'Status', 'CurrentCustodian', 'ScanCount', 'Suspicious'];
    const rows = packs.map((p) =>
      [
        p.serialNumber,
        p.batchId.slice(0, 14),
        p.status,
        `"${p.currentCustodian}"`,
        p.scanCount,
        p.isSuspicious ? 'YES' : 'NO',
      ].join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `medsupply_sentinel_audit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRecordTelemetry = async (overrideTemp?: number) => {
    const batch = batches.find((b) => b.batchId === selectedBatchForIoT);
    if (!batch) return;
    const tempVal = overrideTemp !== undefined ? overrideTemp : parseFloat(simTemperature);
    if (Number.isNaN(tempVal)) return;

    try {
      const res = await executeSignedCommand('telemetry', batch.batchId, {
        batchId: batch.batchId,
        temperature: tempVal,
        hubId: selectedHubForIoT,
        location: simLocation.trim(),
        deviceId: 'IOT-DHT22-901',
      });
      const evalResult = res.evaluation as { isBreached: boolean } | undefined;
      setIotFeedback(
        evalResult?.isBreached
          ? `Overheat Alert: ${tempVal.toFixed(1)}°C is outside the safe range (${batch.minTemp}°C – ${batch.maxTemp}°C) for ${batch.batchCode}.`
          : `Safe reading (${tempVal.toFixed(1)}°C) recorded for ${batch.batchCode}.`
      );
    } catch (err) {
      setIotFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const activeIoTBatch = useMemo(
    () => batches.find((b) => b.batchId === selectedBatchForIoT) || batches[0],
    [batches, selectedBatchForIoT]
  );

  const handleSendHardwareSignedIoT = async (replayPrevious = false) => {
    try {
      let bodyPayload = lastHardwarePacket;
      if (!replayPrevious || !bodyPayload) {
        const batch = activeIoTBatch;
        const hub = logisticsHubs.find((h) => h.id === selectedHubForIoT) || logisticsHubs[3];
        const tempVal = parseFloat(simTemperature) || 4.8;
        const timestamp = new Date().toISOString();
        const deviceId = 'HW-ATECC608A-901';
        const digest = buildHardwareTelemetryDigest({
          batchId: batch.batchId,
          temperature: tempVal,
          humidity: 54.0,
          latitude: hub.coordinates[1],
          longitude: hub.coordinates[0],
          timestamp,
          deviceId,
        });
        const hwAccount = privateKeyToAccount(DEV_IOT_GATEWAY_KEY);
        const signature = await hwAccount.signMessage({
          message: { raw: digest as `0x${string}` },
        });
        bodyPayload = {
          batchId: batch.batchId,
          temperature: tempVal,
          humidity: 54.0,
          latitude: hub.coordinates[1],
          longitude: hub.coordinates[0],
          timestamp,
          deviceId,
          hubId: hub.id,
          signature,
        };
        setLastHardwarePacket(bodyPayload);
      }

      const res = await fetch('/api/iot/signed-telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        verifiedSensorAddress?: string;
        state?: Record<string, unknown>;
      };
      if (!res.ok || !data.ok) {
        setIotFeedback(data.error || `Sensor packet rejected (HTTP ${res.status})`);
        return;
      }
      if (data.state) applyServerState(data.state);
      setIotFeedback(
        `Signed hardware packet accepted from trusted sensor (${data.verifiedSensorAddress?.slice(0, 10)}...) and locked against replay.`
      );
    } catch (err) {
      setIotFeedback(err instanceof Error ? err.message : String(err));
    }
  };

  const activeBatchTelemetry = useMemo(
    () => telemetry.filter((t) => t.batchId === activeIoTBatch.batchId),
    [telemetry, activeIoTBatch]
  );

  const activeBatchMKT = useMemo(
    () => calculateMeanKineticTemperature(activeBatchTelemetry.map((t) => t.temperature)),
    [activeBatchTelemetry]
  );

  const predictiveColdChain = useMemo(
    () =>
      evaluatePredictiveColdChain(
        activeBatchTelemetry,
        activeIoTBatch.minTemp,
        activeIoTBatch.maxTemp
      ),
    [activeBatchTelemetry, activeIoTBatch]
  );

  const handleToggleQuarantine = async (batchId: string, quarantineState: boolean) => {
    setRegulatorErrorMsg('');
    setRegulatorSuccessMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'QUARANTINE_BATCH');
    if (!rbac.allowed) {
      setRegulatorErrorMsg(
        rbac.reason || `Please switch to a Safety Regulator account to change batch holds.`
      );
      return;
    }

    const targetBatch = batches.find((b) => b.batchId === batchId);
    if (!targetBatch) return;

    try {
      await executeSignedCommand('quarantine', batchId, {
        batchId,
        quarantineState,
        reason: quarantineReasonInput,
      });
      setRegulatorSuccessMsg(
        quarantineState
          ? `Safety hold placed on ${targetBatch.batchCode} by ${activeSigner.label}.`
          : `Safety hold released on ${targetBatch.batchCode} by ${activeSigner.label}.`
      );
    } catch (err) {
      setRegulatorErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleProposeRecall = async (batchId: string) => {
    setRegulatorErrorMsg('');
    setRegulatorSuccessMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'PROPOSE_RECALL');
    if (!rbac.allowed) {
      setRegulatorErrorMsg(
        rbac.reason || `Please switch to a Safety Regulator account to propose recalls.`
      );
      return;
    }
    const targetBatch = batches.find((b) => b.batchId === batchId);
    if (!targetBatch) return;
    try {
      await executeSignedCommand('recall-propose', batchId, {
        batchId,
        reason:
          quarantineReasonInput.trim() ||
          'Mandatory Class I Recall: Thermal degradation & sterility risk',
      });
      setRegulatorSuccessMsg(
        `Recall proposed for ${targetBatch.batchCode} (1 of 2 inspector signatures). Switch to Inspector #2 to co-sign and activate.`
      );
    } catch (err) {
      setRegulatorErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApproveRecallProposal = async (proposalId: string) => {
    setRegulatorErrorMsg('');
    setRegulatorSuccessMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'PROPOSE_RECALL');
    if (!rbac.allowed) {
      setRegulatorErrorMsg(
        rbac.reason || `Please switch to a Safety Regulator account to co-sign recalls.`
      );
      return;
    }
    try {
      const res = await executeSignedCommand('recall-approve', proposalId, { proposalId });
      if (res.quorumReached) {
        setRegulatorSuccessMsg(
          `2-of-2 approvals completed! Class I Recall is now active for ${String(res.batchCode || '')}.`
        );
      }
    } catch (err) {
      setRegulatorErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleWitnessDestruction = async (batchId: string) => {
    setRegulatorErrorMsg('');
    setRegulatorSuccessMsg('');
    const rbac = canRoleExecuteAction(activeSigner.role, 'WITNESS_DESTRUCTION');
    if (!rbac.allowed) {
      setRegulatorErrorMsg(rbac.reason || 'Please switch to a Safety Regulator account.');
      return;
    }
    try {
      const res = await executeSignedCommand('witness-destruction', batchId, { batchId });
      setRegulatorSuccessMsg(
        `Confirmed witnessed disposal of ${String(res.transitioned || 0)} recalled pack(s).`
      );
    } catch (err) {
      setRegulatorErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegisterParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    const rbac = canRoleExecuteAction(activeSigner.role, 'MANAGE_PARTICIPANTS');
    if (!rbac.allowed) {
      setParticipantMsg(
        rbac.reason || `Switch to a Safety Regulator account to authorize new organizations.`
      );
      return;
    }
    try {
      const res = await executeSignedCommand('participant-register', newOrgName.trim(), {
        organizationName: newOrgName.trim(),
        role: newOrgRole,
        licenseNumber: newOrgLicense.trim(),
        walletAddress: newOrgWallet.trim(),
        region: newOrgRegion.trim() || 'US National Logistics Network',
      });
      const created = res.created as ParticipantEntity | undefined;
      setNewOrgName('');
      setNewOrgWallet('');
      setNewOrgLicense('');
      setParticipantMsg(
        `Authorized ${created?.organizationName || newOrgName} as ${created?.role || newOrgRole}.`
      );
    } catch (err) {
      setParticipantMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleParticipantAuth = async (id: string) => {
    const rbac = canRoleExecuteAction(activeSigner.role, 'MANAGE_PARTICIPANTS');
    if (!rbac.allowed) {
      setParticipantMsg(
        rbac.reason || `Switch to a Safety Regulator account to modify network access.`
      );
      return;
    }
    try {
      await executeSignedCommand('participant-toggle', id, { id });
    } catch (err) {
      setParticipantMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetPersistentDatabase = async () => {
    const rbac = canRoleExecuteAction(activeSigner.role, 'LEDGER_RESET');
    if (!rbac.allowed) {
      setParticipantMsg(
        rbac.reason || `Switch to a Safety Regulator role in the top menu to reset demo data.`
      );
      return;
    }
    try {
      await executeSignedCommand('ledger-reset', 'GLOBAL', {});
      setLastDispensedZkWitness(null);
      setLastHardwarePacket(null);
      setOfflineResultOverride(null);
      setPufClonedFlag(false);
      setSignatureTamperedFlag(false);
      setImpossibleJumpFlag(false);
      setLastPufCheck(null);
      setJumpSummaryText('');
      setScanNotification('');
      setCopiedQrMsg('');
      setLastScannedSerial('SN-PCV20-2026-0001');
      setScanSerialInput('SN-PCV20-2026-0001');
      setParticipantMsg('Demo ledger restored to initial clean state.');
    } catch (err) {
      setParticipantMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const authorizedDistributors = useMemo(
    () => participants.filter((p) => p.role === 'DISTRIBUTOR' && p.isAuthorized),
    [participants]
  );

  const authorizedPharmacies = useMemo(
    () => participants.filter((p) => p.role === 'PHARMACY' && p.isAuthorized),
    [participants]
  );

  const filteredPacks = useMemo(() => {
    if (!packFilterQuery.trim()) return packs;
    const q = packFilterQuery.toLowerCase();
    return packs.filter(
      (p) =>
        p.serialNumber.toLowerCase().includes(q) ||
        p.currentCustodian.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q)
    );
  }, [packs, packFilterQuery]);

  const totalBatchesCount = batches.length;
  const totalPacksCount = packs.length;
  const quarantinedBatchesCount = batches.filter((b) => b.isQuarantined || b.isRecalled).length;
  const breachEventsCount = telemetry.filter((t) => t.isBreached).length;

  const checkpointOptions = useMemo(
    () =>
      Object.entries(SCAN_CHECKPOINTS).map(([key, cp]) => ({
        key,
        label: cp.label,
      })),
    []
  );

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.06),_transparent_52%)] text-slate-100 flex flex-col">
      {/* Clean Top Bar: Brand | 6 Presentation Views | Security Lab + Role Switcher */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/90 px-3 sm:px-4 lg:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('flow');
          }}
          className="font-display text-sm sm:text-base xl:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          MedSupply Sentinel
        </a>

        <nav
          className="hidden lg:flex items-center gap-2.5 xl:gap-5 text-xs xl:text-[13px] font-medium text-slate-400"
          aria-label="Main Navigation"
        >
          {(
            [
              { id: 'flow', label: 'Blockchain Flow' },
              { id: 'verify', label: 'Verify Medicine' },
              { id: 'supply-chain', label: 'Supply Chain' },
              { id: 'cold-chain', label: 'Cold Chain' },
              { id: 'regulator', label: 'Recall & Safety' },
              { id: 'explorer', label: 'Audit & Proofs' },
            ] as { id: ActiveSection; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                activeSection === item.id
                  ? 'text-emerald-400 border-emerald-400'
                  : 'border-transparent'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Active Execution Mode Indicator & Architecture Popover */}
          <div className="relative" ref={modeMenuRef}>
            <button
              type="button"
              data-testid="active-mode-trigger"
              onClick={() => setModeMenuOpen((o) => !o)}
              aria-expanded={modeMenuOpen}
              title="Inspect active ledger, verification, and RBAC modes"
              className={`px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 sm:gap-1.5 ${
                simulatedOfflineMode
                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-700'
              }`}
            >
              {simulatedOfflineMode ? (
                <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span>
                <span className="hidden sm:inline">Mode: </span>
                {simulatedOfflineMode ? 'Offline' : evmStatus?.connected ? 'Live EVM' : 'SQLite'}
              </span>
              <ChevronDown className="w-3 h-3 shrink-0 text-slate-400 hidden sm:inline" />
            </button>

            {modeMenuOpen && (
              <div
                data-testid="active-mode-popover"
                className="fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-3.5 z-50 text-xs space-y-2.5"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-semibold text-slate-100">Active Operating Modes</span>
                  <span className="text-[10px] font-mono text-slate-400">v{ledgerVersion}</span>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">1. Ledger Storage</span>
                    <span className="text-[11px] font-mono text-emerald-400">
                      {evmStatus?.connected ? 'Live EVM + SQLite' : 'SQLite Hash-Chained'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {evmStatus?.connected
                      ? 'Dual-writing signed custody events to local Anvil EVM smart contracts and SQLite WAL.'
                      : 'Every custody handover seals an EIP-712 signature into a SHA-256 hash-chained SQLite ledger.'}
                  </p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">2. Clinic Verification</span>
                    <span
                      className={`text-[11px] font-mono ${
                        simulatedOfflineMode ? 'text-amber-300' : 'text-sky-400'
                      }`}
                    >
                      {simulatedOfflineMode ? 'Offline Cache' : 'Online Live'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {simulatedOfflineMode
                      ? 'Verifying scans locally against the cached IndexedDB Merkle & ECDSA snapshot.'
                      : 'Validating QR signatures, geo-velocity checks, and cold-chain history in real time.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSimulatedOfflineMode((prev) => !prev)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    {simulatedOfflineMode ? 'Switch to Online Mode' : 'Test Offline Clinic Mode'}
                  </button>
                </div>

                <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">3. Supply Chain RBAC</span>
                    <span
                      className={`text-[11px] font-mono ${
                        autoSwitchSupplyRole ? 'text-sky-300' : 'text-emerald-400'
                      }`}
                    >
                      {autoSwitchSupplyRole ? 'Guided Auto-Switch' : 'Strict Enforcement'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {autoSwitchSupplyRole
                      ? 'Automatically switches to the required Manufacturer, Carrier, or Pharmacy signer on handover.'
                      : 'Blocks unauthorized roles so you can prove strict smart-contract style RBAC.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAutoSwitchSupplyRole((prev) => !prev)}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                  >
                    {autoSwitchSupplyRole ? 'Use Strict RBAC' : 'Enable 1-Click Guided Mode'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('explorer');
                    setModeMenuOpen(false);
                  }}
                  className="w-full py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-semibold border border-emerald-500/30 transition-colors"
                >
                  Open Audit & Proofs Studio
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setRedTeamOpen(true)}
            title="Test counterfeit & spoofing defenses live"
            className="px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 sm:gap-1.5"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>
              <span className="hidden sm:inline">Security </span>Lab
            </span>
          </button>

          {/* Clean Role Selector Menu */}
          <div className="relative" ref={roleMenuRef}>
            <button
              type="button"
              onClick={() => setRoleMenuOpen((o) => !o)}
              aria-expanded={roleMenuOpen}
              aria-label={`Switch active role, currently ${activeSigner.label}`}
              className="px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 sm:gap-1.5"
            >
              <span className="truncate max-w-[76px] sm:max-w-none">
                {injectedWalletAddress ? (
                  `Wallet ${injectedWalletAddress.slice(0, 4)}..${injectedWalletAddress.slice(-3)}`
                ) : (
                  <>
                    <span className="hidden sm:inline">Role: </span>
                    {FRIENDLY_SIGNER_SHORT_NAMES[signerIndex] || activeSigner.role}
                  </>
                )}
              </span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>

            {roleMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 text-xs">
                <div className="px-2.5 py-1.5 text-[11px] font-medium text-slate-400 border-b border-slate-800 mb-1">
                  Switch Operating Account
                </div>
                {ROLE_SIGNERS.map((signer, idx) => {
                  const isActive = !injectedWalletAddress && signerIndex === idx;
                  return (
                    <button
                      key={signer.address}
                      type="button"
                      onClick={() => handleSelectSignerIndex(idx)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 transition-colors ${
                        isActive
                          ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                          : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <div>
                        <div>{signer.label}</div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {signer.address.slice(0, 8)}...{signer.address.slice(-4)}
                        </div>
                      </div>
                      {isActive && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
                <div className="border-t border-slate-800 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={handleConnectBrowserWallet}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                  >
                    <Wallet className="w-3.5 h-3.5 text-sky-400" />
                    Connect Browser Wallet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile navigation bar */}
      <div className="flex lg:hidden items-center gap-2 overflow-x-auto px-3 sm:px-4 py-2 bg-slate-900 border-b border-slate-800">
        {(
          [
            { id: 'flow', label: 'Flow' },
            { id: 'verify', label: 'Verify' },
            { id: 'supply-chain', label: 'Supply Chain' },
            { id: 'cold-chain', label: 'Cold Chain' },
            { id: 'regulator', label: 'Recall & Safety' },
            { id: 'explorer', label: 'Audit & Proofs' },
          ] as { id: ActiveSection; label: string }[]
        ).map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActiveSection(sec.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeSection === sec.id
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-6 sm:space-y-7">
        {/* Clean 4-Metric Summary Strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Medicine Batches</span>
              <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-emerald-400">
                <Layers className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-bold text-slate-100 tabular-nums">
                {totalBatchesCount}
              </span>
              <span className="text-xs text-slate-400">Active lots tracked</span>
            </div>
            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{
                  width: `${
                    totalBatchesCount > 0
                      ? Math.max(
                          12,
                          Math.round(
                            ((totalBatchesCount - quarantinedBatchesCount) / totalBatchesCount) *
                              100
                          )
                        )
                      : 100
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Tracked Packs</span>
              <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-sky-400">
                <QrCode className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-bold text-slate-100 tabular-nums">
                {totalPacksCount}
              </span>
              <span className="text-xs text-slate-400">QR-sealed units</span>
            </div>
            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{
                  width: `${
                    totalPacksCount > 0
                      ? Math.max(
                          12,
                          Math.round(
                            (packs.filter(
                              (p) =>
                                p.status !== 'QUARANTINED' &&
                                p.status !== 'RECALLED' &&
                                p.status !== 'DESTROYED_WITNESSED'
                            ).length /
                              totalPacksCount) *
                              100
                          )
                        )
                      : 100
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Temperature Alerts</span>
              <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-bold text-amber-400 tabular-nums">
                {breachEventsCount}
              </span>
              <span className="text-xs text-slate-400">Storage warnings</span>
            </div>
            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{
                  width: `${
                    telemetry.length > 0
                      ? Math.max(8, Math.round((breachEventsCount / telemetry.length) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Blocked Batches</span>
              <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-rose-400">
                <ShieldCheck className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-3xl font-bold text-rose-400 tabular-nums">
                {quarantinedBatchesCount}
              </span>
              <span className="text-xs text-slate-400">Held or recalled</span>
            </div>
            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 transition-all duration-300"
                style={{
                  width: `${
                    totalBatchesCount > 0
                      ? Math.max(
                          quarantinedBatchesCount > 0 ? 12 : 0,
                          Math.round((quarantinedBatchesCount / totalBatchesCount) * 100)
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </section>

        {activeSection === 'flow' && (
          <BlockchainFlowPortal
            packs={packs}
            batches={batches}
            custodyEvents={custodyEvents}
            telemetry={telemetry}
            participants={participants}
            auditLog={auditLog}
            evmStatus={evmStatus}
            activeRole={activeSigner.role}
            issuerPublicAddress={issuerPublicAddress}
            onAdvanceStage={handleAdvanceFlowStage}
            onOpenCustomerVerify={(serial) => {
              setActiveSection('verify');
              handleVerifySerial(serial, false);
            }}
            onOpenSupplyChainMap={(serial) => {
              setTrackedMapPackSerial(serial);
              setActiveSection('supply-chain');
            }}
            onOpenAuditStudio={() => setActiveSection('explorer')}
            onOpenSecurityLab={() => setRedTeamOpen(true)}
          />
        )}

        {activeSection === 'verify' && (
          <VerifyPortal
            scanSerialInput={scanSerialInput}
            onScanSerialInputChange={setScanSerialInput}
            scanCheckpointKey={scanCheckpointKey}
            checkpoints={checkpointOptions}
            onSelectCheckpoint={(key) => {
              setCustomScanCoords(null);
              setScanCheckpointKey(key);
            }}
            onUseBrowserGPS={handleUseBrowserGPS}
            onOpenScannerModal={() => setScannerModalOpen(true)}
            onVerify={handleVerifySerial}
            onTestTamperedQR={handleTestTamperedQR}
            scanNotification={scanNotification}
            copiedQrMsg={copiedQrMsg}
            activeVerification={activeVerification}
            activePackCryptoProof={activePackCryptoProof}
            lastPufCheck={lastPufCheck}
            jumpSummaryText={jumpSummaryText}
            onLoadGS1DigitalLink={handleLoadGS1DigitalLink}
            onCopySignedQRPayload={handleCopySignedQRPayload}
            offlineVault={offlineVault}
            simulatedOfflineMode={simulatedOfflineMode}
            onToggleOfflineMode={() => setSimulatedOfflineMode((prev) => !prev)}
            onSyncOfflineVault={syncOfflineEdgeVault}
            queuedOfflineScans={queuedOfflineScans}
            onFlushQueuedOfflineScans={handleFlushQueuedOfflineScans}
            lastVerifyMeta={lastVerifyMeta}
            reportCategory={reportCategory}
            onReportCategoryChange={setReportCategory}
            reportLocationCity={reportLocationCity}
            onReportLocationCityChange={setReportLocationCity}
            reportNotes={reportNotes}
            onReportNotesChange={setReportNotes}
            reportSubmittedMsg={reportSubmittedMsg}
            onSubmitReport={handleReportSuspiciousPack}
            batches={batches}
          />
        )}

        {activeSection === 'supply-chain' && (
          <SupplyChainPortal
            supplyRoleTab={supplyRoleTab}
            onChangeSupplyRoleTab={(tab) => {
              setSupplyRoleTab(tab);
              setCustodyErrorMsg('');
              setCustodySuccessMsg('');
            }}
            activeRole={activeSigner.role}
            activeRoleLabel={activeSigner.label}
            onSwitchToRole={(role) => handleSwitchToRole(role)}
            autoSwitchSupplyRole={autoSwitchSupplyRole}
            onToggleAutoSwitchSupplyRole={() => setAutoSwitchSupplyRole((prev) => !prev)}
            custodyErrorMsg={custodyErrorMsg}
            custodySuccessMsg={custodySuccessMsg}
            onDismissCustodySuccess={() => setCustodySuccessMsg('')}
            liveSseBanner={liveSseBanner}
            onDismissLiveSseBanner={() => setLiveSseBanner('')}
            onDownloadAuditCSV={handleDownloadAuditCSV}
            logisticsHubs={logisticsHubs}
            transitCorridors={transitCorridors}
            custodyEvents={custodyEvents}
            trackedMapPackSerial={trackedMapPackSerial}
            onSelectTrackedMapPack={setTrackedMapPackSerial}
            onRerouteCorridor={(corridorId) => {
              executeSignedCommand('corridor-reroute', corridorId, { corridorId }).catch((err) =>
                setCustodyErrorMsg(err instanceof Error ? err.message : String(err))
              );
            }}
            onClearHubBottleneck={(hubId) => {
              executeSignedCommand('hub-resolve', hubId, { hubId }).catch((err) =>
                setCustodyErrorMsg(err instanceof Error ? err.message : String(err))
              );
            }}
            pallets={pallets}
            batches={batches}
            packs={packs}
            palletBatchId={palletBatchId}
            onChangePalletBatchId={(nextB) => {
              setPalletBatchId(nextB);
              const firstP = packs.find(
                (pk) =>
                  pk.batchId === nextB && (pk.status === 'MANUFACTURED' || pk.status === 'IN_TRANSIT')
              );
              setSelectedPalletSerials(firstP ? [firstP.serialNumber] : []);
            }}
            selectedPalletSerials={selectedPalletSerials}
            onTogglePalletSerial={(serial) =>
              setSelectedPalletSerials((prev) =>
                prev.includes(serial) ? prev.filter((s) => s !== serial) : [...prev, serial]
              )
            }
            onCommissionPallet={handleCommissionPallet}
            palletMsg={palletMsg}
            onTransferPallet={handleTransferPallet}
            onDeaggregatePallet={handleDeaggregatePallet}
            dispatchDistributorName={dispatchDistributorName}
            onChangeDispatchDistributorName={setDispatchDistributorName}
            dispatchDestinationHubId={dispatchDestinationHubId}
            onChangeDispatchDestinationHubId={setDispatchDestinationHubId}
            deliveryPharmacyName={deliveryPharmacyName}
            onChangeDeliveryPharmacyName={setDeliveryPharmacyName}
            deliveryHubId={deliveryHubId}
            onChangeDeliveryHubId={setDeliveryHubId}
            deliveryHandoverTemp={deliveryHandoverTemp}
            onChangeDeliveryHandoverTemp={setDeliveryHandoverTemp}
            dispensePatientRef={dispensePatientRef}
            onChangeDispensePatientRef={setDispensePatientRef}
            dispenseClinicDesk={dispenseClinicDesk}
            onChangeDispenseClinicDesk={setDispenseClinicDesk}
            authorizedDistributors={authorizedDistributors}
            authorizedPharmacies={authorizedPharmacies}
            newBatchCode={newBatchCode}
            onChangeNewBatchCode={setNewBatchCode}
            newBrandName={newBrandName}
            onChangeNewBrandName={setNewBrandName}
            newOriginHubId={newOriginHubId}
            onChangeNewOriginHubId={setNewOriginHubId}
            newDestHubId={newDestHubId}
            onChangeNewDestHubId={setNewDestHubId}
            newMinTemp={newMinTemp}
            onChangeNewMinTemp={setNewMinTemp}
            newMaxTemp={newMaxTemp}
            onChangeNewMaxTemp={setNewMaxTemp}
            batchFormError={batchFormError}
            batchFormSuccess={batchFormSuccess}
            onCreateBatch={handleCreateBatch}
            selectedBatchForMint={selectedBatchForMint}
            onChangeSelectedBatchForMint={setSelectedBatchForMint}
            mintPackCount={mintPackCount}
            onChangeMintPackCount={setMintPackCount}
            onMintPacks={handleMintPacks}
            packFilterQuery={packFilterQuery}
            onChangePackFilterQuery={setPackFilterQuery}
            filteredPacks={filteredPacks}
            packPage={packPage}
            packsPerPage={PACKS_PER_PAGE}
            onChangePackPage={setPackPage}
            onTransferCustody={handleTransferCustody}
            onInspectPackQR={(serial) => {
              setActiveSection('verify');
              handleVerifySerial(serial, false);
            }}
            lastDispensedZkWitness={lastDispensedZkWitness}
            onOpenZkStudioWithWitness={() => {
              if (!lastDispensedZkWitness) return;
              setPrefillZkWitness({
                serial: lastDispensedZkWitness.serial,
                rxId: lastDispensedZkWitness.rxId,
                salt: lastDispensedZkWitness.salt,
              });
              setActiveSection('explorer');
            }}
          />
        )}

        {activeSection === 'cold-chain' && (
          <ColdChainPortal
            batches={batches}
            logisticsHubs={logisticsHubs}
            telemetry={telemetry}
            activeIoTBatch={activeIoTBatch}
            activeBatchTelemetry={activeBatchTelemetry}
            activeBatchMKT={activeBatchMKT}
            predictiveColdChain={predictiveColdChain}
            selectedBatchForIoT={selectedBatchForIoT}
            onChangeSelectedBatchForIoT={setSelectedBatchForIoT}
            selectedHubForIoT={selectedHubForIoT}
            onChangeSelectedHubForIoT={(hubId) => {
              setSelectedHubForIoT(hubId);
              const hub = logisticsHubs.find((h) => h.id === hubId);
              if (hub) setSimLocation(`${hub.name}, ${hub.cityState}`);
            }}
            simTemperature={simTemperature}
            onChangeSimTemperature={setSimTemperature}
            simLocation={simLocation}
            onChangeSimLocation={setSimLocation}
            onRecordTelemetry={handleRecordTelemetry}
            onSendHardwareSignedIoT={handleSendHardwareSignedIoT}
            hasLastHardwarePacket={Boolean(lastHardwarePacket)}
            iotFeedback={iotFeedback}
          />
        )}

        {activeSection === 'regulator' && (
          <RegulatorPortal
            activeRole={activeSigner.role}
            activeRoleLabel={activeSigner.label}
            onSwitchToRegulator={(idx) => handleSwitchToRole('REGULATOR', idx)}
            regulatorErrorMsg={regulatorErrorMsg}
            regulatorSuccessMsg={regulatorSuccessMsg}
            quarantineReasonInput={quarantineReasonInput}
            onChangeQuarantineReason={setQuarantineReasonInput}
            batches={batches}
            packs={packs}
            recallProposals={recallProposals}
            adverseReports={adverseReports}
            onToggleQuarantine={handleToggleQuarantine}
            onProposeRecall={handleProposeRecall}
            onApproveRecallProposal={handleApproveRecallProposal}
            onWitnessDestruction={handleWitnessDestruction}
          />
        )}

        {activeSection === 'explorer' && (
          <GovernanceExplorerPortal
            batches={batches}
            packs={packs}
            custodyEvents={custodyEvents}
            telemetry={telemetry}
            auditLog={auditLog}
            evmStatus={evmStatus}
            ledgerVersion={ledgerVersion}
            issuerPublicAddress={issuerPublicAddress}
            prefillZkWitness={prefillZkWitness}
            onProbeEvmRpc={probeEvmStatus}
            activeRole={activeSigner.role}
            onAnchorBatchMerkleRoot={(batchId, merkleRoot) => {
              executeSignedCommand('anchor-merkle', batchId, { batchId, merkleRoot }).catch(
                (err) => setParticipantMsg(err instanceof Error ? err.message : String(err))
              );
            }}
            onAuditBreakGlassShamir={async (serialNumber, shareIndices, unsealedShares) => {
              await executeSignedCommand('break-glass-shamir', serialNumber, {
                serialNumber,
                shareIndices,
                unsealedShares,
              });
            }}
            onResetPersistentDatabase={handleResetPersistentDatabase}
            participants={participants}
            newOrgName={newOrgName}
            onChangeNewOrgName={setNewOrgName}
            newOrgRole={newOrgRole}
            onChangeNewOrgRole={setNewOrgRole}
            newOrgLicense={newOrgLicense}
            onChangeNewOrgLicense={setNewOrgLicense}
            newOrgWallet={newOrgWallet}
            onChangeNewOrgWallet={setNewOrgWallet}
            participantMsg={participantMsg}
            onRegisterParticipant={handleRegisterParticipant}
            onToggleParticipantAuth={handleToggleParticipantAuth}
          />
        )}
      </main>

      <footer className="border-t border-slate-900 py-5 px-6 text-center text-xs text-slate-500">
        MedSupply Sentinel · Pharmaceutical Traceability &amp; Cold-Chain Safety Platform
      </footer>

      <QRScannerModal
        isOpen={scannerModalOpen}
        onClose={() => setScannerModalOpen(false)}
        onDecoded={(decodedPayload) => {
          handleVerifySerial(decodedPayload, false);
        }}
      />

      <RedTeamAttackLab
        isOpen={redTeamOpen}
        onClose={() => setRedTeamOpen(false)}
        batches={batches}
        packs={packs}
        ledgerVersion={ledgerVersion}
        onSyncLedgerState={applyServerState}
        onInspectVerifiedPack={(serialNumber, pufCloned) => {
          setRedTeamOpen(false);
          setActiveSection('verify');
          handleVerifySerial(serialNumber, false, Boolean(pufCloned));
        }}
      />
    </div>
  );
}
