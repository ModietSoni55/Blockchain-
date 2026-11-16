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
  PlusCircle,
  Thermometer,
  MapPin,
  QrCode,
  Gavel,
  Play,
  Smartphone,
  X,
} from 'lucide-react';
import {
  BatchRecord,
  CommandAuditRecord,
  CustodyEvent,
  LogisticsHubNode,
  MedicinePackRecord,
  ParticipantEntity,
  QRPhoneScanFormat,
  RoleType,
  TelemetryEvent,
  buildBatchMerkleTree,
  buildHashChainedBlocks,
  buildPhoneScannableQRCertificate,
  computeKeccakHex,
  generateMerkleInclusionProof,
  traceSupplyChainStageForensics,
} from '../utils/sentinelLogic';
import { formatCustodyActionLabel, formatPackStatusLabel } from '../utils/uiLabels';
import { EvmStatusInfo } from './BlockchainCryptographyStudio';
import { QRCodeMatrix } from './QRCodeMatrix';

export type FlowStageAdvanceAction =
  | 'SHIP_TO_DISTRIBUTOR'
  | 'DELIVER_TO_PHARMACY'
  | 'DISPENSE_TO_CUSTOMER';

interface BlockchainFlowPortalProps {
  packs: MedicinePackRecord[];
  batches: BatchRecord[];
  custodyEvents: CustodyEvent[];
  telemetry: TelemetryEvent[];
  participants: ParticipantEntity[];
  logisticsHubs?: LogisticsHubNode[];
  auditLog: CommandAuditRecord[];
  evmStatus: EvmStatusInfo | null;
  activeRole: RoleType;
  issuerPublicAddress: string;
  onAdvanceStage: (
    serialNumber: string,
    action: FlowStageAdvanceAction,
    options?: {
      nextCustodian?: string;
      hubIdOrLocation?: string;
      handoverTemp?: number;
      prescriptionRef?: string;
      simulateUnauthorizedBroker?: boolean;
    }
  ) => Promise<void>;
  onCreateBatchAndSelect: (params: {
    batchCode: string;
    brandName: string;
    genericName?: string;
    minTemp: number;
    maxTemp: number;
    originHubId?: string;
    destHubId?: string;
    initialTemp?: number;
  }) => Promise<{ batchId: string; batchCode: string; firstSerial: string }>;
  onRecordBatchTelemetry: (
    batchId: string,
    temperature: number,
    locationLabel?: string,
    hubId?: string
  ) => Promise<{ isBreached: boolean; breachType?: 'OVERHEATING' | 'SUBCOOLING' }>;
  onInspectorQuarantineBatch?: (
    batchId: string,
    quarantineState: boolean,
    reason: string
  ) => Promise<void>;
  onInspectorExecuteRecall?: (batchId: string, reason: string) => Promise<void>;
  onOpenColdChainMonitor?: (batchId: string) => void;
  onOpenRegulatorPortal?: (batchId: string) => void;
  onTestForgedQRForPack?: (serialNumber: string) => void;
  onOpenCustomerVerify: (serialNumber: string) => void;
  onOpenSupplyChainMap?: (serialNumber: string) => void;
  onOpenAuditStudio: () => void;
  onOpenSecurityLab: () => void;
  selectedPackSerial?: string;
  onSelectPackSerial?: (serialNumber: string) => void;
}

function shortHex(hex: string | undefined, head = 10, tail = 6): string {
  if (!hex) return '—';
  if (hex.length <= head + tail + 3) return hex;
  return `${hex.slice(0, head)}...${hex.slice(-tail)}`;
}

type CustomerInlineScanMode = 'GENUINE' | 'RESOLD_QR' | 'FORGED_SIGNATURE' | 'CLONED_PUF';
type DemoScenarioPreset =
  | 'SAFE_FLOW'
  | 'TEMP_DROP'
  | 'RESOLD_QR'
  | 'FAKE_DIVERSION'
  | 'FULL_MULTI_FAULT';

export const BlockchainFlowPortal: React.FC<BlockchainFlowPortalProps> = ({
  packs,
  batches,
  custodyEvents,
  telemetry,
  participants,
  logisticsHubs = [],
  evmStatus,
  issuerPublicAddress,
  onAdvanceStage,
  onCreateBatchAndSelect,
  onRecordBatchTelemetry,
  onInspectorQuarantineBatch,
  onInspectorExecuteRecall,
  onOpenColdChainMonitor,
  onOpenRegulatorPortal,
  onTestForgedQRForPack,
  onOpenCustomerVerify,
  onOpenSupplyChainMap,
  onOpenAuditStudio,
  onOpenSecurityLab,
  selectedPackSerial,
  onSelectPackSerial,
}) => {
  const defaultPack =
    packs.find((p) => p.serialNumber === 'SN-PCV20-2026-0004') ||
    packs.find((p) => p.status === 'MANUFACTURED') ||
    packs[0];

  const [internalSelectedSerial, setInternalSelectedSerial] = useState<string>(
    defaultPack?.serialNumber || 'SN-PCV20-2026-0001'
  );
  const selectedSerial = selectedPackSerial || internalSelectedSerial;
  const updateSelectedSerial = (serial: string) => {
    setInternalSelectedSerial(serial);
    if (onSelectPackSerial) onSelectPackSerial(serial);
  };

  const [tamperBlockOne, setTamperBlockOne] = useState<boolean>(false);
  const [inlineScanMode, setInlineScanMode] = useState<CustomerInlineScanMode>('GENUINE');
  const [qrPhoneFormat, setQrPhoneFormat] = useState<QRPhoneScanFormat>('PHONE_CERTIFICATE');
  const [showPhonePreviewModal, setShowPhonePreviewModal] = useState<boolean>(false);
  const [isAdvancing, setIsAdvancing] = useState<boolean>(false);
  const [isCreatingBatch, setIsCreatingBatch] = useState<boolean>(false);
  const [isLoggingTemp] = useState<boolean>(false);
  const [isRunningAutoDemo, setIsRunningAutoDemo] = useState<boolean>(false);
  const [isInspectorBusy, setIsInspectorBusy] = useState<boolean>(false);
  const [flowFeedback, setFlowFeedback] = useState<string>('');
  const [avalancheInput, setAvalancheInput] = useState<string>(
    'SN-PCV20-2026-0004|BATCH-PCV-2026|2C-8C'
  );

  // Stage 1: Manufacturer Order & Cold-Chain Assignment Form State
  const [demoBrandName, setDemoBrandName] = useState<string>('Insulin Cold Vial');
  const [demoBatchCode, setDemoBatchCode] = useState<string>('LOT-INS-2026');
  const [demoMinTemp, setDemoMinTemp] = useState<string>('2.0');
  const [demoMaxTemp, setDemoMaxTemp] = useState<string>('8.0');
  const [demoOriginHubId, setDemoOriginHubId] = useState<string>('hub-kalamazoo');
  const [demoMfgTemp, setDemoMfgTemp] = useState<string>('4.2');

  // Stage 2: Distributor Order Handover (Assigned Place + Assigned Temp)
  const [distCarrierName] = useState<string>('Apex Cold-Chain Logistics');
  const [distHubId, setDistHubId] = useState<string>('hub-chicago');
  const [distAssignedTemp, setDistAssignedTemp] = useState<string>('4.6');

  // Stage 3: Pharmacy Order Handover (Assigned Place + Assigned Temp + Patient Rx)
  const [pharmName] = useState<string>('City Central Hospital Pharmacy');
  const [pharmHubId, setPharmHubId] = useState<string>('hub-boston');
  const [pharmAssignedTemp, setPharmAssignedTemp] = useState<string>('4.4');
  const [patientRxId] = useState<string>('RX-2026-88412');

  // Stage 5: Safety Inspector Order Reason
  const [inspectorReason, setInspectorReason] = useState<string>(
    'Inspector Order: Cold-chain excursion / suspected counterfeit resale audit hold'
  );

  const selectedPack = useMemo(
    () => packs.find((p) => p.serialNumber === selectedSerial) || packs[0],
    [packs, selectedSerial]
  );

  const selectedBatch = useMemo(
    () => batches.find((b) => b.batchId === selectedPack?.batchId) || batches[0],
    [batches, selectedPack]
  );

  const mfgHubOptions = useMemo(() => {
    const plants = logisticsHubs.filter((h) => h.role === 'MANUFACTURER_PLANT');
    return plants.length > 0
      ? plants
      : [
          {
            id: 'hub-kalamazoo',
            name: 'Kalamazoo Sterile Plant',
            cityState: 'Kalamazoo, MI',
          },
          {
            id: 'hub-basel',
            name: 'Basel Biopharma Sterile Plant',
            cityState: 'Basel, CH',
          },
        ];
  }, [logisticsHubs]);

  const distHubOptions = useMemo(() => {
    const hubs = logisticsHubs.filter(
      (h) => h.role === 'COLD_HUB' || h.role === 'REGIONAL_DEPOT'
    );
    return hubs.length > 0
      ? hubs
      : [
          { id: 'hub-chicago', name: 'Chicago O’Hare Cold Hub', cityState: 'Chicago, IL' },
          { id: 'hub-newark', name: 'Newark I-95 Cold Port', cityState: 'Newark, NJ' },
          { id: 'hub-memphis', name: 'Memphis Cryo Air SuperHub', cityState: 'Memphis, TN' },
          { id: 'hub-frankfurt', name: 'Frankfurt Perishable Air Vault', cityState: 'Frankfurt, DE' },
        ];
  }, [logisticsHubs]);

  const pharmHubOptions = useMemo(() => {
    const vaults = logisticsHubs.filter((h) => h.role === 'HOSPITAL_PHARMACY');
    return vaults.length > 0
      ? vaults
      : [
          { id: 'hub-boston', name: 'Boston Medical Receiving Vault', cityState: 'Boston, MA' },
          {
            id: 'hub-sanfrancisco',
            name: 'South San Francisco Biologics Vault',
            cityState: 'San Francisco, CA',
          },
          { id: 'hub-london', name: 'London Heathrow NHS Cold Vault', cityState: 'London, UK' },
        ];
  }, [logisticsHubs]);

  const packEventsChronological = useMemo(() => {
    if (!selectedPack) return [];
    const matched = custodyEvents.filter(
      (e) => e.serialHash.toLowerCase() === selectedPack.serialHash.toLowerCase()
    );
    return [...matched].reverse();
  }, [custodyEvents, selectedPack]);

  const packBlocks = useMemo(() => {
    if (!packEventsChronological.length) return [];
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

  const batchTelemetry = useMemo(
    () => (selectedBatch ? telemetry.filter((t) => t.batchId === selectedBatch.batchId) : []),
    [telemetry, selectedBatch]
  );

  const latestBreach = batchTelemetry.find((t) => t.isBreached);
  const hasTempBreach = Boolean(latestBreach);

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

  // Forensic Attribution Report across all 4 stages
  const forensicReport = useMemo(
    () =>
      traceSupplyChainStageForensics(selectedPack, selectedBatch, custodyEvents, telemetry, {
        tamperBlockOne,
        signatureTampered: inlineScanMode === 'FORGED_SIGNATURE',
        pufCloned: inlineScanMode === 'CLONED_PUF',
        simulateResaleScan: inlineScanMode === 'RESOLD_QR',
      }),
    [selectedPack, selectedBatch, custodyEvents, telemetry, tamperBlockOne, inlineScanMode]
  );

  // Tamper-simulation hash cascade across stages
  const genesisBlock = packBlocks[0];
  const distributorBlock =
    packBlocks.find((b) => b.primaryAction === 'TRANSFER_DISTRIBUTOR') || packBlocks[1];

  const displayedGenesisHash = useMemo(() => {
    const real = genesisBlock?.blockHash || selectedPack?.serialHash || computeKeccakHex('GENESIS');
    if (!tamperBlockOne) return real;
    return computeKeccakHex(`TAMPERED_PAYLOAD:${real}`);
  }, [genesisBlock, selectedPack, tamperBlockOne]);

  const stage2Broken =
    (tamperBlockOne && stage2Done) ||
    forensicReport.stages[1]?.stageStatus === 'COUNTERFEIT_OR_DIVERSION' ||
    forensicReport.stages[1]?.stageStatus === 'TEMP_BREACH_ORIGIN';
  const stage3Broken =
    (tamperBlockOne && stage3Arrived) ||
    forensicReport.stages[2]?.stageStatus === 'TEMP_BREACH_ORIGIN';
  const stage4Broken = forensicReport.overallStatus !== 'AUTHENTIC_SAFE';

  const liveAvalancheHash = useMemo(
    () => computeKeccakHex(avalancheInput || 'empty'),
    [avalancheInput]
  );

  const previewBatchHash = useMemo(
    () => computeKeccakHex(demoBatchCode.trim() || 'BATCH-NEW'),
    [demoBatchCode]
  );

  const activeQrPayloadString = useMemo(
    () =>
      buildPhoneScannableQRCertificate(selectedPack, selectedBatch, forensicReport, {
        format: qrPhoneFormat,
        forgedSignature: inlineScanMode === 'FORGED_SIGNATURE',
        clonedPuf: inlineScanMode === 'CLONED_PUF',
        resoldMode: inlineScanMode === 'RESOLD_QR',
      }),
    [selectedPack, selectedBatch, forensicReport, qrPhoneFormat, inlineScanMode]
  );

  const phoneCertificateText = useMemo(
    () =>
      buildPhoneScannableQRCertificate(selectedPack, selectedBatch, forensicReport, {
        format: 'PHONE_CERTIFICATE',
        forgedSignature: inlineScanMode === 'FORGED_SIGNATURE',
        clonedPuf: inlineScanMode === 'CLONED_PUF',
        resoldMode: inlineScanMode === 'RESOLD_QR',
      }),
    [selectedPack, selectedBatch, forensicReport, inlineScanMode]
  );

  const handleSelectPack = (serial: string) => {
    updateSelectedSerial(serial);
    setInlineScanMode('GENUINE');
    const pk = packs.find((p) => p.serialNumber === serial);
    const bt = batches.find((b) => b.batchId === pk?.batchId);
    if (pk && bt) {
      setAvalancheInput(`${pk.serialNumber}|${bt.batchCode}|${bt.minTemp}C-${bt.maxTemp}C`);
    }
    setFlowFeedback('');
  };

  const handleDemoCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const minT = parseFloat(demoMinTemp);
    const maxT = parseFloat(demoMaxTemp);
    const mfgT = parseFloat(demoMfgTemp);
    if (!demoBrandName.trim() || !demoBatchCode.trim() || Number.isNaN(minT) || Number.isNaN(maxT)) {
      setFlowFeedback('Enter valid medicine name, batch code, and safe min/max temperatures.');
      return;
    }
    if (minT >= maxT) {
      setFlowFeedback('Minimum safe temperature must be lower than maximum safe temperature.');
      return;
    }
    setIsCreatingBatch(true);
    setFlowFeedback('');
    try {
      const safeMid = Number(((minT + maxT) / 2).toFixed(1));
      const initialTemp = Number.isNaN(mfgT) ? safeMid : mfgT;
      const created = await onCreateBatchAndSelect({
        batchCode: demoBatchCode.trim().toUpperCase(),
        brandName: demoBrandName.trim(),
        genericName: `${demoBrandName.trim()} Cold-Chain Formulation`,
        minTemp: minT,
        maxTemp: maxT,
        originHubId: demoOriginHubId,
        destHubId: distHubId,
        initialTemp,
      });
      updateSelectedSerial(created.firstSerial);
      setInlineScanMode('GENUINE');
      setDistAssignedTemp(String(safeMid));
      setPharmAssignedTemp(String(safeMid));
      setAvalancheInput(`${created.firstSerial}|${created.batchCode}|${minT}C-${maxT}C`);
      const nextSuffix = String(Math.floor(1000 + Math.random() * 9000));
      setDemoBatchCode(`LOT-MED-${nextSuffix}`);
      const originLabel =
        mfgHubOptions.find((h) => h.id === demoOriginHubId)?.name || 'Manufacturing Plant';
      setFlowFeedback(
        `Stage 1 Complete: Manufacturer created ${created.batchCode} (${minT}°C–${maxT}°C) at ${originLabel} (${initialTemp.toFixed(1)}°C) and minted ${created.firstSerial}. Now pass the order to the Distributor in Phase 2.`
      );
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingBatch(false);
    }
  };

  const handlePassOrderToDistributor = async (
    overrideTemp?: number,
    simulateBrokerDiversion = false
  ) => {
    if (!selectedPack || !selectedBatch) return;
    const tempVal =
      overrideTemp !== undefined
        ? overrideTemp
        : parseFloat(distAssignedTemp) ||
          Number(((selectedBatch.minTemp + selectedBatch.maxTemp) / 2).toFixed(1));
    const hubObj = distHubOptions.find((h) => h.id === distHubId);
    const placeLabel = hubObj ? `${hubObj.name}, ${hubObj.cityState}` : 'Chicago O’Hare Cold Hub, IL';

    setIsAdvancing(true);
    setFlowFeedback('');
    try {
      if (selectedPack.status === 'MANUFACTURED') {
        await onAdvanceStage(selectedPack.serialNumber, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: tempVal,
          simulateUnauthorizedBroker: simulateBrokerDiversion,
        });
      } else {
        await onRecordBatchTelemetry(
          selectedBatch.batchId,
          tempVal,
          `${placeLabel} (${distCarrierName})`,
          distHubId
        );
      }

      if (simulateBrokerDiversion) {
        setFlowFeedback(
          `ALERT: Unlicensed Grey-Market Broker diversion injected at ${placeLabel}! See the Forensic Pinpointer below identifying Stage 2 (Distributor) as the exact point of compromise.`
        );
      } else if (tempVal < selectedBatch.minTemp || tempVal > selectedBatch.maxTemp) {
        setInspectorReason(
          `Cold-chain excursion (${tempVal.toFixed(1)}°C outside ${selectedBatch.minTemp}°C–${selectedBatch.maxTemp}°C) pinpointed at ${placeLabel} under ${distCarrierName}`
        );
        setFlowFeedback(
          `COLD-CHAIN BREACH AT DISTRIBUTOR: Order passed to ${distCarrierName} at ${placeLabel} with ${tempVal.toFixed(1)}°C (safe range ${selectedBatch.minTemp}°C–${selectedBatch.maxTemp}°C). Sealed on the Cold-Chain Blockchain & pinpointed below!`
        );
      } else {
        setFlowFeedback(
          `Stage 2 Order Passed: ${selectedPack.serialNumber} shipped to ${distCarrierName} at ${placeLabel} with safe temperature ${tempVal.toFixed(1)}°C. Next, pass the order to the Pharmacy in Phase 3.`
        );
      }
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdvancing(false);
    }
  };

  const handlePassOrderToPharmacy = async (overrideTemp?: number) => {
    if (!selectedPack || !selectedBatch) return;
    const tempVal =
      overrideTemp !== undefined
        ? overrideTemp
        : parseFloat(pharmAssignedTemp) ||
          Number(((selectedBatch.minTemp + selectedBatch.maxTemp) / 2).toFixed(1));
    const hubObj = pharmHubOptions.find((h) => h.id === pharmHubId);
    const placeLabel = hubObj
      ? `${hubObj.name}, ${hubObj.cityState}`
      : 'Boston Medical Receiving Vault, MA';

    setIsAdvancing(true);
    setFlowFeedback('');
    try {
      if (selectedPack.status === 'MANUFACTURED') {
        await onAdvanceStage(selectedPack.serialNumber, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: Number(((selectedBatch.minTemp + selectedBatch.maxTemp) / 2).toFixed(1)),
        });
      }
      if (selectedPack.status === 'MANUFACTURED' || selectedPack.status === 'IN_TRANSIT') {
        await onAdvanceStage(selectedPack.serialNumber, 'DELIVER_TO_PHARMACY', {
          nextCustodian: pharmName,
          hubIdOrLocation: pharmHubId,
          handoverTemp: tempVal,
        });
      } else {
        await onRecordBatchTelemetry(
          selectedBatch.batchId,
          tempVal,
          `${placeLabel} (${pharmName})`,
          pharmHubId
        );
      }

      if (tempVal < selectedBatch.minTemp || tempVal > selectedBatch.maxTemp) {
        setInspectorReason(
          `Pharmacy vault cold-chain breach (${tempVal.toFixed(1)}°C) pinpointed at ${placeLabel} (${pharmName})`
        );
        setFlowFeedback(
          `COLD-CHAIN BREACH AT PHARMACY: ${selectedPack.serialNumber} received at ${placeLabel} (${pharmName}) at ${tempVal.toFixed(1)}°C! Pinpointed to Stage 3 (Pharmacy) below.`
        );
      } else {
        setFlowFeedback(
          `Stage 3a Order Received: ${selectedPack.serialNumber} delivered to ${pharmName} at ${placeLabel} (${tempVal.toFixed(1)}°C). Click "Sell / Dispense to Patient" to lock the QR.`
        );
      }
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleSellAndLockAtPharmacy = async (simulateImmediateResaleScan = false) => {
    if (!selectedPack || !selectedBatch) return;
    const hubObj = pharmHubOptions.find((h) => h.id === pharmHubId);
    const placeLabel = hubObj
      ? `${hubObj.name}, ${hubObj.cityState}`
      : 'Boston Medical Receiving Vault, MA';

    setIsAdvancing(true);
    setFlowFeedback('');
    try {
      if (selectedPack.status === 'MANUFACTURED') {
        await onAdvanceStage(selectedPack.serialNumber, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: parseFloat(distAssignedTemp) || 4.6,
        });
      }
      if (selectedPack.status === 'MANUFACTURED' || selectedPack.status === 'IN_TRANSIT') {
        await onAdvanceStage(selectedPack.serialNumber, 'DELIVER_TO_PHARMACY', {
          nextCustodian: pharmName,
          hubIdOrLocation: pharmHubId,
          handoverTemp: parseFloat(pharmAssignedTemp) || 4.4,
        });
      }
      if (selectedPack.status !== 'DISPENSED') {
        await onAdvanceStage(selectedPack.serialNumber, 'DISPENSE_TO_CUSTOMER', {
          hubIdOrLocation: `${pharmName} (${placeLabel})`,
          prescriptionRef: patientRxId || 'RX-2026-88412',
        });
      }

      if (simulateImmediateResaleScan) {
        setInlineScanMode('RESOLD_QR');
        setInspectorReason(
          `Unauthorized resale / reused QR code (${selectedPack.serialNumber}) detected after sale at ${pharmName} (${placeLabel})`
        );
        setFlowFeedback(
          `RESALE DETECTED BY CUSTOMER QR SCAN: ${selectedPack.serialNumber} was sold & Soulbound-locked at ${pharmName} (${placeLabel}), and a second customer scan immediately blocked the reused QR!`
        );
      } else {
        setInlineScanMode('GENUINE');
        setFlowFeedback(
          `Stage 3b Complete: ${selectedPack.serialNumber} sold & dispensed to Patient (${patientRxId}) at ${placeLabel}. Customer QR scan (Phase 4) confirms the medicine is AUTHENTIC & DISPENSED TO PATIENT! Click "Simulate Pharmacy Reselling Sold QR" if you want to test blocking a resold QR.`
        );
      }
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleRunScenarioPreset = async (scenario: DemoScenarioPreset) => {
    setIsRunningAutoDemo(true);
    setTamperBlockOne(false);
    setFlowFeedback('Step 1: Manufacturer creating medicine batch with cold-chain bounds & hash...');
    try {
      const suffix = String(Date.now()).slice(-4);
      const code =
        scenario === 'SAFE_FLOW'
          ? `LOT-SAFE-${suffix}`
          : scenario === 'TEMP_DROP'
          ? `LOT-DROP-${suffix}`
          : scenario === 'RESOLD_QR'
          ? `LOT-RESALE-${suffix}`
          : scenario === 'FAKE_DIVERSION'
          ? `LOT-FAKE-${suffix}`
          : `LOT-DEMO-${suffix}`;
      const minT = parseFloat(demoMinTemp) || 2.0;
      const maxT = parseFloat(demoMaxTemp) || 8.0;
      const safeMid = Number(((minT + maxT) / 2).toFixed(1));
      const dropTemp = Number((minT - 3.5).toFixed(1));

      const created = await onCreateBatchAndSelect({
        batchCode: code,
        brandName: demoBrandName.trim() || 'Insulin Cold Vial',
        genericName: `${demoBrandName.trim() || 'Insulin'} Cold-Chain Formulation`,
        minTemp: minT,
        maxTemp: maxT,
        originHubId: demoOriginHubId,
        destHubId: distHubId,
        initialTemp: safeMid,
      });

      updateSelectedSerial(created.firstSerial);

      if (scenario === 'SAFE_FLOW') {
        setFlowFeedback(`Step 2: Passing order ${created.firstSerial} to Distributor at safe ${safeMid}°C...`);
        await onAdvanceStage(created.firstSerial, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: safeMid,
        });
        setFlowFeedback(`Step 3: Delivering order to Pharmacy (${pharmName}) at safe ${safeMid}°C...`);
        await onAdvanceStage(created.firstSerial, 'DELIVER_TO_PHARMACY', {
          nextCustodian: pharmName,
          hubIdOrLocation: pharmHubId,
          handoverTemp: safeMid,
        });
        setInlineScanMode('GENUINE');
        setFlowFeedback(
          `Scenario 1 Complete (Genuine Safe Order): ${created.firstSerial} passed Manufacturer → Distributor → Pharmacy within ${minT}°C–${maxT}°C. Customer QR scan shows VERIFIED AUTHENTIC & COLD-CHAIN SAFE!`
        );
      } else if (scenario === 'TEMP_DROP') {
        setFlowFeedback(
          `Step 2: Passing order ${created.firstSerial} to Distributor (${distCarrierName}) and triggering ${dropTemp}°C temperature drop...`
        );
        await onAdvanceStage(created.firstSerial, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: dropTemp,
        });
        setInlineScanMode('GENUINE');
        setInspectorReason(
          `Cold-chain freeze drop (${dropTemp}°C < ${minT}°C) pinpointed at ${distCarrierName} (${distHubId})`
        );
        setFlowFeedback(
          `Scenario 2 Complete (Distributor Temperature Drop): ${created.firstSerial} dropped to ${dropTemp}°C at ${distCarrierName}. See Stage 2 in the Forensic Pinpointer below!`
        );
      } else if (scenario === 'RESOLD_QR') {
        await onAdvanceStage(created.firstSerial, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: safeMid,
        });
        await onAdvanceStage(created.firstSerial, 'DELIVER_TO_PHARMACY', {
          nextCustodian: pharmName,
          hubIdOrLocation: pharmHubId,
          handoverTemp: safeMid,
        });
        await onAdvanceStage(created.firstSerial, 'DISPENSE_TO_CUSTOMER', {
          hubIdOrLocation: `${pharmName} (Boston, MA)`,
          prescriptionRef: patientRxId || 'RX-2026-88412',
        });
        setInlineScanMode('RESOLD_QR');
        setInspectorReason(
          `Previously sold QR code (${created.firstSerial}) resold after patient sale at ${pharmName}`
        );
        setFlowFeedback(
          `Scenario 3 Complete (Pharmacy Resold QR): ${created.firstSerial} was sold & ERC-5192 Soulbound-locked at ${pharmName}, then scanned again by a customer — immediately BLOCKED as a resold QR!`
        );
      } else if (scenario === 'FAKE_DIVERSION') {
        await onAdvanceStage(created.firstSerial, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: safeMid,
          simulateUnauthorizedBroker: true,
        });
        setInlineScanMode('FORGED_SIGNATURE');
        setInspectorReason(
          `Unlicensed broker diversion + forged counterfeit QR detected on ${created.firstSerial}`
        );
        setFlowFeedback(
          `Scenario 4 Complete (Fake Broker & Forged QR): Unlicensed broker diversion injected at Stage 2 + Forged QR signature detected at Customer Scan!`
        );
      } else {
        // FULL_MULTI_FAULT (Default 1-Click Full Demo)
        setFlowFeedback(
          `Step 2/4: Passing order ${created.firstSerial} to Distributor (${distCarrierName}) and triggering ${dropTemp}°C temperature drop...`
        );
        await onAdvanceStage(created.firstSerial, 'SHIP_TO_DISTRIBUTOR', {
          nextCustodian: distCarrierName,
          hubIdOrLocation: distHubId,
          handoverTemp: dropTemp,
        });
        setFlowFeedback(
          `Step 3/4: Delivering order to Pharmacy (${pharmName}) and selling/locking QR to Patient (${patientRxId})...`
        );
        await onAdvanceStage(created.firstSerial, 'DELIVER_TO_PHARMACY', {
          nextCustodian: pharmName,
          hubIdOrLocation: pharmHubId,
          handoverTemp: safeMid,
        });
        await onAdvanceStage(created.firstSerial, 'DISPENSE_TO_CUSTOMER', {
          hubIdOrLocation: `${pharmName} (Boston, MA)`,
          prescriptionRef: patientRxId || 'RX-2026-88412',
        });
        setInlineScanMode('RESOLD_QR');
        setInspectorReason(
          `Automated Forensic Audit on ${created.batchCode}: Distributor temperature drop (${dropTemp}°C) + Pharmacy resold QR (${created.firstSerial}) detected.`
        );
        setFlowFeedback(
          `Full Demo Complete for ${created.firstSerial}! See the Forensic Pinpointer below: both the Distributor Temperature Drop (${dropTemp}°C) AND the Pharmacy Previously-Sold QR Resale are pinpointed to their exact stage, facility, and blockchain block.`
        );
      }
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningAutoDemo(false);
    }
  };

  const handleRunFullGuidedDemo = () => handleRunScenarioPreset('FULL_MULTI_FAULT');

  const handleInspectorQuarantineClick = async () => {
    if (!selectedBatch || !onInspectorQuarantineBatch) return;
    setIsInspectorBusy(true);
    setFlowFeedback('');
    try {
      const nextQuarantine = !selectedBatch.isQuarantined;
      await onInspectorQuarantineBatch(
        selectedBatch.batchId,
        nextQuarantine,
        inspectorReason.trim() || 'Inspector safety hold following cold-chain / counterfeit audit'
      );
      setFlowFeedback(
        nextQuarantine
          ? `Inspector Order Executed: Batch ${selectedBatch.batchCode} placed under Regulatory Quarantine Hold.`
          : `Inspector Order Executed: Quarantine lifted on Batch ${selectedBatch.batchCode}.`
      );
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInspectorBusy(false);
    }
  };

  const handleInspectorRecallClick = async () => {
    if (!selectedBatch || !onInspectorExecuteRecall) return;
    setIsInspectorBusy(true);
    setFlowFeedback('');
    try {
      await onInspectorExecuteRecall(
        selectedBatch.batchId,
        inspectorReason.trim() ||
          'Mandatory Class I Recall: Cold-chain breach & counterfeit resale risk'
      );
      setFlowFeedback(
        `2-of-2 Regulator Multi-Sig Executed: Batch ${selectedBatch.batchCode} is now under permanent Class I Recall.`
      );
    } catch (err) {
      setFlowFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInspectorBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Presenter Hero & Pack Controls */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 border-b border-slate-800 pb-6">
        <div className="space-y-2 max-w-2xl">
          <div className="text-xs font-medium text-emerald-400">
            Interactive Supply-Chain Order, Cold-Chain &amp; Anti-Counterfeit Simulator
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
            Manufacturer Hash to Customer QR Verification
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Create a medicine with assigned temperature and origin place, pass the order through
            Distributor and Pharmacy hubs, and pinpoint the exact stage and facility of any
            temperature drop, fake injection, or resold QR code.
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
            disabled={isRunningAutoDemo}
            onClick={handleRunFullGuidedDemo}
            className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            {isRunningAutoDemo ? 'Running Full Demo...' : 'Run 1-Click Full Demo'}
          </button>

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

      {/* 5-Scenario Interactive Demo Switcher Strip */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-300 font-medium">
          <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>1-Click Live Demo Scenarios (Auto-correlates across all 6 tabs):</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isRunningAutoDemo}
            onClick={() => handleRunScenarioPreset('SAFE_FLOW')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-emerald-700/60 text-emerald-300 font-medium transition-colors"
          >
            1. Genuine Safe Flow
          </button>
          <button
            type="button"
            disabled={isRunningAutoDemo}
            onClick={() => handleRunScenarioPreset('TEMP_DROP')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-sky-700/60 text-sky-300 font-medium transition-colors"
          >
            2. Distributor Temp Drop (-1.5°C)
          </button>
          <button
            type="button"
            disabled={isRunningAutoDemo}
            onClick={() => handleRunScenarioPreset('RESOLD_QR')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-amber-700/60 text-amber-300 font-medium transition-colors"
          >
            3. Pharmacy Resold QR
          </button>
          <button
            type="button"
            disabled={isRunningAutoDemo}
            onClick={() => handleRunScenarioPreset('FAKE_DIVERSION')}
            className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-rose-700/60 text-rose-300 font-medium transition-colors"
          >
            4. Fake Broker &amp; Forged QR
          </button>
          <button
            type="button"
            disabled={isRunningAutoDemo}
            onClick={() => handleRunScenarioPreset('FULL_MULTI_FAULT')}
            className="px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/60 text-sky-200 font-semibold transition-colors"
          >
            5. Combined Temp Drop + Resale
          </button>
        </div>
      </div>

      {/* Live Feedback Banner */}
      {(flowFeedback || tamperBlockOne) && (
        <div
          className={`p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            tamperBlockOne || flowFeedback.includes('BREACH') || flowFeedback.includes('ALERT') || flowFeedback.includes('RESALE')
              ? 'bg-rose-950/35 border-rose-700/70 text-rose-100'
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
            <div className="text-slate-400">Active Medicine Order &amp; Serialized QR Pack</div>
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
              <span className="text-slate-400 block">Required Storage Range</span>
              <span className="font-mono tabular-nums text-sky-300">
                {selectedBatch.minTemp.toFixed(1)}°C – {selectedBatch.maxTemp.toFixed(1)}°C
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Current Custodian &amp; Place</span>
              <span className="font-medium text-slate-200">
                {selectedPack.currentCustodian} · {selectedPack.lastScannedLocation || 'Origin'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Current Stage</span>
              <span className="font-semibold text-emerald-300">
                {formatPackStatusLabel(selectedPack.status)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Demo Action Workbench: Step 1 - Manufacturer Creates Medicine + Assigned Temp + Origin Place */}
      <form
        onSubmit={handleDemoCreateBatch}
        className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-100 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-emerald-400" />
              Step 1 · Manufacturer: Create Medicine Order, Assigned Safe Temperature &amp; Origin Place
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Set the medicine’s required min/max cold-chain limits, manufacturing plant location, and
              initial vault temperature, then pass the order to Distributor and Pharmacy below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
            <button
              type="button"
              onClick={() => {
                setDemoBrandName('Insulin Cold Vial');
                setDemoBatchCode(`LOT-INS-${String(Date.now()).slice(-4)}`);
                setDemoMinTemp('2.0');
                setDemoMaxTemp('8.0');
                setDemoMfgTemp('4.2');
                setDistAssignedTemp('4.6');
                setPharmAssignedTemp('4.4');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200"
            >
              Preset: Insulin (2–8°C)
            </button>
            <button
              type="button"
              onClick={() => {
                setDemoBrandName('mRNA Cryo Vaccine');
                setDemoBatchCode(`LOT-CRYO-${String(Date.now()).slice(-4)}`);
                setDemoMinTemp('-20.0');
                setDemoMaxTemp('-10.0');
                setDemoMfgTemp('-15.0');
                setDistAssignedTemp('-14.5');
                setPharmAssignedTemp('-15.2');
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-sky-300"
            >
              Preset: mRNA Cryo (-20 to -10°C)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-2">
            <label htmlFor="demo-brand-name" className="block text-xs font-medium text-slate-300 mb-1">
              Medicine Name
            </label>
            <input
              id="demo-brand-name"
              type="text"
              value={demoBrandName}
              onChange={(e) => setDemoBrandName(e.target.value)}
              placeholder="e.g. Insulin Cold Vial"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
              required
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="demo-batch-code" className="block text-xs font-medium text-slate-300 mb-1">
              Batch Code
            </label>
            <input
              id="demo-batch-code"
              type="text"
              value={demoBatchCode}
              onChange={(e) => setDemoBatchCode(e.target.value)}
              placeholder="LOT-INS-2026"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100"
              required
            />
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="demo-origin-hub" className="block text-xs font-medium text-slate-300 mb-1">
              Origin Plant (Place)
            </label>
            <select
              id="demo-origin-hub"
              value={demoOriginHubId}
              onChange={(e) => setDemoOriginHubId(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
            >
              {mfgHubOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.cityState})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-1">
            <label htmlFor="demo-min-temp" className="block text-xs font-medium text-slate-300 mb-1">
              Min (°C)
            </label>
            <input
              id="demo-min-temp"
              type="number"
              step="0.1"
              value={demoMinTemp}
              onChange={(e) => setDemoMinTemp(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100"
              required
            />
          </div>

          <div className="lg:col-span-1">
            <label htmlFor="demo-max-temp" className="block text-xs font-medium text-slate-300 mb-1">
              Max (°C)
            </label>
            <input
              id="demo-max-temp"
              type="number"
              step="0.1"
              value={demoMaxTemp}
              onChange={(e) => setDemoMaxTemp(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100"
              required
            />
          </div>

          <div className="lg:col-span-1">
            <label htmlFor="demo-mfg-temp" className="block text-xs font-medium text-slate-300 mb-1">
              Vault (°C)
            </label>
            <input
              id="demo-mfg-temp"
              type="number"
              step="0.1"
              value={demoMfgTemp}
              onChange={(e) => setDemoMfgTemp(e.target.value)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-300"
              required
            />
          </div>

          <div className="lg:col-span-3">
            <button
              type="submit"
              disabled={isCreatingBatch}
              className="w-full py-2 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              {isCreatingBatch ? 'Minting Order...' : '1. Create Order & Mint Signed QR'}
            </button>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-all">
            Preview Keccak-256 Batch Hash: <span className="text-emerald-300 break-all">{previewBatchHash}</span>
          </span>
          <span className="font-sans text-slate-500">
            Seals Genesis Block #1 + Plant Vault Temp onto Cold-Chain Blockchain
          </span>
        </div>
      </form>

      {/* SECTION 1: 4-Stage Interactive Order Passing & Blockchain Pipeline */}
      <section aria-labelledby="pipeline-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 id="pipeline-heading" className="text-lg font-bold text-slate-100">
              Interactive 4-Stage Order Handover &amp; Anomaly Simulator
            </h2>
            <p className="text-xs text-slate-400">
              Pass the medicine order from Manufacturer → Distributor → Pharmacy → Customer QR Scan with
              assigned temperature and place, or inject a temperature drop / fake medicine at any stage.
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
                <h3 className="text-base font-bold text-slate-100">1. Manufacturer Origin</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Assigns required cold-chain range, origin plant location, Keccak-256 serial hash,
                  ECDSA QR signature, and optical PUF seal.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500 font-sans block">Origin Facility &amp; Actor</span>
                  <span className="text-slate-200 font-sans">
                    {forensicReport.stages[0]?.actor} · {forensicReport.stages[0]?.location}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans block">Assigned Safe Range &amp; Vault Temp</span>
                  <span className="text-emerald-300">
                    {selectedBatch?.minTemp.toFixed(1)}°C to {selectedBatch?.maxTemp.toFixed(1)}°C (Vault:{' '}
                    {forensicReport.stages[0]?.recordedTempC !== undefined
                      ? `${forensicReport.stages[0].recordedTempC.toFixed(1)}°C`
                      : '4.2°C'}
                    )
                  </span>
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
                  <span className="text-slate-500 font-sans block">Genesis Block Hash</span>
                  <span
                    className={
                      tamperBlockOne
                        ? 'text-rose-400 font-bold break-all'
                        : 'text-emerald-400 break-all'
                    }
                  >
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
                <span className="font-mono font-semibold text-sky-400">Phase 2 · Distributor Order</span>
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
                      <XCircle className="w-3.5 h-3.5" /> Breach / Diversion
                    </>
                  ) : stage2Done ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Linked
                    </>
                  ) : (
                    'Ready for Order'
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">2. Manufacturer → Distributor</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Send medicine to Distributor with assigned transit hub and temperature, or simulate a
                  temperature drop / unlicensed broker injection.
                </p>
              </div>

              {/* Distributor Order Assignment Controls */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5 text-xs">
                <div>
                  <label htmlFor="flow-dist-hub" className="block text-[11px] text-slate-400 mb-1">
                    Assigned Distributor Hub / Place
                  </label>
                  <select
                    id="flow-dist-hub"
                    value={distHubId}
                    onChange={(e) => setDistHubId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"
                  >
                    {distHubOptions.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.cityState})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <label htmlFor="flow-dist-temp">Assigned Transit Temp (°C)</label>
                    <span className="font-mono text-slate-500">
                      Safe: {selectedBatch?.minTemp ?? 2}–{selectedBatch?.maxTemp ?? 8}°C
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="flow-dist-temp"
                      type="number"
                      step="0.1"
                      value={distAssignedTemp}
                      onChange={(e) => setDistAssignedTemp(e.target.value)}
                      className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const safeVal = Number(
                          (((selectedBatch?.minTemp ?? 2) + (selectedBatch?.maxTemp ?? 8)) / 2).toFixed(1)
                        );
                        setDistAssignedTemp(String(safeVal));
                      }}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300"
                    >
                      Safe
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const dropVal = Number(((selectedBatch?.minTemp ?? 2) - 3.5).toFixed(1));
                        setDistAssignedTemp(String(dropVal));
                      }}
                      className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-[10px] text-rose-200"
                    >
                      Drop &lt;Min
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const spikeVal = Number(((selectedBatch?.maxTemp ?? 8) + 6.5).toFixed(1));
                        setDistAssignedTemp(String(spikeVal));
                      }}
                      className="px-2 py-1 rounded bg-amber-950/60 hover:bg-amber-900/70 border border-amber-700/70 text-[10px] text-amber-200"
                    >
                      Spike &gt;Max
                    </button>
                  </div>
                </div>

                <div className="pt-1 border-t border-slate-800/80 font-mono text-[11px] space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 font-sans">Recorded Hub Temp:</span>
                    <span
                      className={
                        forensicReport.stages[1]?.tempStatus === 'SUBCOOLING_DROP' ||
                        forensicReport.stages[1]?.tempStatus === 'OVERHEAT_SPIKE'
                          ? 'text-rose-400 font-semibold'
                          : 'text-emerald-300'
                      }
                    >
                      {forensicReport.stages[1]?.recordedTempC !== undefined
                        ? `${forensicReport.stages[1].recordedTempC.toFixed(1)}°C (${
                            forensicReport.stages[1].tempStatus === 'SUBCOOLING_DROP'
                              ? 'TOO COLD Alert'
                              : forensicReport.stages[1].tempStatus === 'OVERHEAT_SPIKE'
                              ? 'OVERHEAT Alert'
                              : 'Safe'
                          })`
                        : 'Pending dispatch'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 font-sans">Links to Phase 1:</span>
                    <span className="text-slate-300">
                      {stage2Done
                        ? shortHex(distributorBlock?.parentBlockHash || displayedGenesisHash, 8, 6)
                        : 'Awaiting'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <button
                type="button"
                disabled={isAdvancing || isLoggingTemp}
                onClick={() => handlePassOrderToDistributor()}
                className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                {selectedPack?.status === 'MANUFACTURED'
                  ? '2. Pass Order to Distributor (Temp & Place)'
                  : 'Update Distributor Checkpoint Temp'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={isAdvancing || isLoggingTemp}
                  onClick={() => {
                    const dropVal = Number(((selectedBatch?.minTemp ?? 2) - 3.5).toFixed(1));
                    setDistAssignedTemp(String(dropVal));
                    handlePassOrderToDistributor(dropVal, false);
                  }}
                  className="py-1.5 px-2 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-rose-200 text-[11px] font-medium rounded-lg flex items-center justify-center gap-1"
                >
                  <Thermometer className="w-3 h-3 text-rose-400" />
                  Trigger Temp Drop
                </button>
                <button
                  type="button"
                  disabled={isAdvancing}
                  onClick={() => handlePassOrderToDistributor(undefined, true)}
                  className="py-1.5 px-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-300 text-[11px] font-medium rounded-lg flex items-center justify-center gap-1"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Inject Fake Broker
                </button>
              </div>
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
                <span className="font-mono font-semibold text-amber-300">Phase 3 · Pharmacy &amp; Sale</span>
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
                      <XCircle className="w-3.5 h-3.5" /> Vault Breach
                    </>
                  ) : stage3Dispensed ? (
                    <>
                      <Lock className="w-3.5 h-3.5" /> Sold &amp; Locked
                    </>
                  ) : stage3Arrived ? (
                    'At Pharmacy Vault'
                  ) : (
                    'Pending Delivery'
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">3. Distributor → Pharmacy</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Deliver order to Pharmacy with assigned vault location &amp; temperature, dispense to
                  patient (ERC-5192 lock), or test reselling a previously sold QR.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5 text-xs">
                <div>
                  <label htmlFor="flow-pharm-hub" className="block text-[11px] text-slate-400 mb-1">
                    Assigned Pharmacy Vault / Place
                  </label>
                  <select
                    id="flow-pharm-hub"
                    value={pharmHubId}
                    onChange={(e) => setPharmHubId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"
                  >
                    {pharmHubOptions.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.cityState})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <label htmlFor="flow-pharm-temp">Assigned Pharmacy Temp (°C)</label>
                    <span className="font-mono text-slate-500">Rx: {patientRxId}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="flow-pharm-temp"
                      type="number"
                      step="0.1"
                      value={pharmAssignedTemp}
                      onChange={(e) => setPharmAssignedTemp(e.target.value)}
                      className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const safeVal = Number(
                          (((selectedBatch?.minTemp ?? 2) + (selectedBatch?.maxTemp ?? 8)) / 2).toFixed(1)
                        );
                        setPharmAssignedTemp(String(safeVal));
                      }}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-emerald-300"
                    >
                      Safe
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const dropVal = Number(((selectedBatch?.minTemp ?? 2) - 4.0).toFixed(1));
                        setPharmAssignedTemp(String(dropVal));
                        handlePassOrderToPharmacy(dropVal);
                      }}
                      className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-[10px] text-rose-200"
                    >
                      Vault Temp Drop
                    </button>
                  </div>
                </div>

                <div className="pt-1 border-t border-slate-800/80 font-mono text-[11px] space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 font-sans">Anti-Resale Lock:</span>
                    <span
                      className={
                        stage3Dispensed
                          ? 'text-emerald-300 flex items-center gap-1'
                          : 'text-slate-300 flex items-center gap-1'
                      }
                    >
                      {stage3Dispensed ? (
                        <>
                          <Lock className="w-3 h-3" /> Locked (Sold)
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3" /> Unspent
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500 font-sans">ZK Receipt:</span>
                    <span className="text-sky-300">
                      {selectedPack?.dispensedToReceipt
                        ? shortHex(selectedPack.dispensedToReceipt, 8, 6)
                        : 'On Patient Sale'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <button
                type="button"
                disabled={isAdvancing}
                onClick={() => handlePassOrderToPharmacy()}
                className={`w-full py-2 px-3 disabled:opacity-50 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  stage3Arrived
                    ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-700/60'
                    : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                }`}
              >
                {stage3Arrived ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                    3a. Update Pharmacy Temp &amp; Place
                  </>
                ) : (
                  <>
                    3a. Pass Order to Pharmacy (Temp &amp; Place)
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isAdvancing}
                onClick={() => handleSellAndLockAtPharmacy(false)}
                className={`w-full py-2 px-3 disabled:opacity-50 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  stage3Dispensed && inlineScanMode !== 'RESOLD_QR'
                    ? 'bg-emerald-950/70 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-600/70'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                {stage3Dispensed && inlineScanMode !== 'RESOLD_QR' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    3b. Sold to Patient (Verified OK)
                  </>
                ) : (
                  <>
                    3b. Sell / Dispense to Patient (Lock QR)
                    <Lock className="w-3.5 h-3.5" />
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isAdvancing}
                onClick={() => handleSellAndLockAtPharmacy(true)}
                className="w-full py-1.5 px-2.5 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/70 text-rose-200 text-[11px] font-medium rounded-lg flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-3 h-3 text-rose-400" />
                Simulate Pharmacy Reselling Sold QR
              </button>
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
                <span className="font-mono font-semibold text-emerald-400">Phase 4 · Customer QR Scan</span>
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
                      <ShieldCheck className="w-3.5 h-3.5" /> Verified Safe
                    </>
                  )}
                </span>
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-100">4. Customer &amp; Inspector Scan</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Customer scans the QR code to verify origin, cold-chain history, and anti-resale lock.
                  Pinpoints any breach or fake below.
                </p>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">1. ECDSA QR Signature</span>
                  <span
                    className={`font-mono ${
                      inlineScanMode === 'FORGED_SIGNATURE'
                        ? 'text-rose-400 font-bold'
                        : 'text-emerald-400'
                    }`}
                  >
                    {inlineScanMode === 'FORGED_SIGNATURE' ? 'FORGED SIGNATURE' : 'Recovered OK'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">2. Optical PUF Seal</span>
                  <span
                    className={`font-mono ${
                      inlineScanMode === 'CLONED_PUF' ? 'text-rose-400 font-bold' : 'text-emerald-400'
                    }`}
                  >
                    {inlineScanMode === 'CLONED_PUF' ? 'PHOTOCOPY CLONE' : 'Verified Genuine'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">3. Hash-Chain Integrity</span>
                  <span
                    className={`font-mono ${
                      tamperBlockOne ? 'text-rose-400 font-bold' : 'text-emerald-400'
                    }`}
                  >
                    {tamperBlockOne ? 'BROKEN AT BLOCK #1' : '100% Intact'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">4. Cold-Chain Safe Range</span>
                  <span
                    className={`font-mono ${
                      hasTempBreach ? 'text-rose-400 font-bold' : 'text-emerald-400'
                    }`}
                  >
                    {hasTempBreach ? 'TEMPERATURE BREACH' : 'Safe'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">5. Resale / Dispense Lock</span>
                  <span
                    className={`font-mono ${
                      inlineScanMode === 'RESOLD_QR'
                        ? 'text-rose-400 font-bold'
                        : 'text-emerald-400'
                    }`}
                  >
                    {inlineScanMode === 'RESOLD_QR'
                      ? 'ALREADY SOLD (RESALE)'
                      : stage3Dispensed
                      ? 'Dispensed to Patient (OK)'
                      : 'Unspent (Ready)'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">6. Inspector Safety Hold</span>
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

            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setInlineScanMode('GENUINE')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border ${
                    inlineScanMode === 'GENUINE'
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-200'
                      : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  Scan Genuine QR
                </button>
                <button
                  type="button"
                  onClick={() => setInlineScanMode('RESOLD_QR')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border ${
                    inlineScanMode === 'RESOLD_QR'
                      ? 'bg-rose-500/25 border-rose-500 text-rose-100'
                      : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-rose-300'
                  }`}
                >
                  Scan Resold QR
                </button>
                <button
                  type="button"
                  onClick={() => setInlineScanMode('FORGED_SIGNATURE')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border ${
                    inlineScanMode === 'FORGED_SIGNATURE'
                      ? 'bg-rose-500/25 border-rose-500 text-rose-100'
                      : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-amber-300'
                  }`}
                >
                  Scan Forged QR
                </button>
                <button
                  type="button"
                  onClick={() => setInlineScanMode('CLONED_PUF')}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border ${
                    inlineScanMode === 'CLONED_PUF'
                      ? 'bg-rose-500/25 border-rose-500 text-rose-100'
                      : 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-sky-300'
                  }`}
                >
                  Scan Cloned Box
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!selectedPack) return;
                  if (inlineScanMode === 'FORGED_SIGNATURE' && onTestForgedQRForPack) {
                    onTestForgedQRForPack(selectedPack.serialNumber);
                  } else {
                    onOpenCustomerVerify(selectedPack.serialNumber);
                  }
                }}
                className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                Open Full Customer Verify Page →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 1.5: Live Forensic Origin Pinpointer + Customer QR Scanner + Safety Inspector Console */}
      <section
        aria-labelledby="forensic-pinpointer-heading"
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
      >
        {/* Left 8 Columns: Where & When Detected — Stage-by-Stage Forensic Attribution */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h2
                id="forensic-pinpointer-heading"
                className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2"
              >
                <MapPin className="w-4 h-4 text-emerald-400" />
                Forensic Stage &amp; Location Pinpointer (Where &amp; Why Detected)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Identifies the exact supply-chain stage, facility location, actor, and blockchain
                block where a temperature drop, fake injection, or previously sold QR resale occurred.
              </p>
            </div>
            <span
              className={`text-xs font-mono font-semibold px-3 py-1.5 rounded-lg border shrink-0 ${
                forensicReport.overallStatus === 'AUTHENTIC_SAFE'
                  ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-700/70 text-rose-200'
              }`}
            >
              {forensicReport.overallStatus === 'AUTHENTIC_SAFE'
                ? 'ALL STAGES VERIFIED SAFE'
                : `${forensicReport.violations.length} VIOLATION(S) PINPOINTED`}
            </span>
          </div>

          {/* Verdict Banner */}
          <div
            className={`p-4 rounded-xl border ${
              forensicReport.overallStatus === 'AUTHENTIC_SAFE'
                ? 'bg-emerald-950/25 border-emerald-700/60 text-emerald-100'
                : 'bg-rose-950/35 border-rose-700/80 text-rose-100'
            }`}
          >
            <div className="flex items-start gap-3">
              {forensicReport.overallStatus === 'AUTHENTIC_SAFE' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 min-w-0">
                <div className="text-sm sm:text-base font-bold">{forensicReport.headline}</div>
                <p className="text-xs text-slate-300 leading-relaxed break-words">
                  {forensicReport.subheadline}
                </p>
              </div>
            </div>
          </div>

          {/* 4-Stage Forensic Attribution Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {forensicReport.stages.map((st) => {
              const isAlert =
                st.stageStatus !== 'VERIFIED' && st.stageStatus !== 'PENDING';
              return (
                <div
                  key={st.stageId}
                  className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                    isAlert
                      ? 'bg-rose-950/25 border-rose-700/70'
                      : st.stageStatus === 'VERIFIED'
                      ? 'bg-slate-950 border-slate-800'
                      : 'bg-slate-950/60 border-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">{st.stageTitle}</span>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        isAlert
                          ? 'text-rose-400'
                          : st.stageStatus === 'VERIFIED'
                          ? 'text-emerald-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {st.stageStatus === 'TEMP_BREACH_ORIGIN'
                        ? 'TEMP BREACH HERE'
                        : st.stageStatus === 'RESOLD_LOCKED_ORIGIN'
                        ? 'RESOLD QR ORIGIN'
                        : st.stageStatus === 'COUNTERFEIT_OR_DIVERSION'
                        ? 'FAKE / DIVERSION HERE'
                        : st.stageStatus === 'REGULATORY_HOLD'
                        ? 'INSPECTOR HOLD'
                        : st.stageStatus}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-300 space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Actor:</span>
                      <span className="font-medium text-right truncate">{st.actor}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Place:</span>
                      <span className="text-slate-200 text-right truncate">{st.location}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Stage Temp:</span>
                      <span
                        className={`font-mono ${
                          st.tempStatus === 'SUBCOOLING_DROP' || st.tempStatus === 'OVERHEAT_SPIKE'
                            ? 'text-rose-400 font-bold'
                            : 'text-emerald-300'
                        }`}
                      >
                        {st.recordedTempC !== undefined
                          ? `${st.recordedTempC.toFixed(1)}°C (Req: ${st.safeRangeLabel})`
                          : `Req: ${st.safeRangeLabel}`}
                      </span>
                    </div>
                  </div>

                  <p
                    className={`text-[11px] leading-relaxed pt-1.5 border-t border-slate-800/80 ${
                      isAlert ? 'text-rose-200 font-medium' : 'text-slate-400'
                    }`}
                  >
                    {st.incidentSummary}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Detailed Pinpointed Violations List */}
          {forensicReport.violations.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="text-xs font-semibold text-rose-300 uppercase tracking-wider">
                Pinpointed Breach &amp; Counterfeit Evidence Log
              </div>
              {forensicReport.violations.map((v) => (
                <div
                  key={v.id}
                  className="p-3.5 rounded-lg bg-slate-950 border border-rose-800/70 text-xs space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-rose-200">{v.title}</span>
                    <span className="font-mono text-[11px] text-rose-300">
                      Stage: {v.detectedAtStage} · Place: {v.culpritLocation}
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{v.detail}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                    <span>
                      Culprit Node: <strong className="text-slate-200">{v.culpritActor}</strong>
                    </span>
                    <span className="font-mono text-emerald-300">
                      Inspector Action: {v.inspectorAction}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 4 Columns: Live Scannable Customer QR + Safety Inspector Order Console */}
        <div className="lg:col-span-4 space-y-5">
          {/* Live Customer QR Code Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-emerald-400" />
                  Live Customer QR Code Scanner
                </h3>
                <p className="text-[11px] text-slate-400">
                  Scan with your phone camera to view the live medicine certificate
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">ISO-18004</span>
            </div>

            {/* Phone Scan Format Switcher */}
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setQrPhoneFormat('PHONE_CERTIFICATE')}
                className={`py-1.5 px-2 rounded-lg border font-medium transition-colors ${
                  qrPhoneFormat === 'PHONE_CERTIFICATE'
                    ? 'bg-emerald-950/60 border-emerald-600 text-emerald-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Phone Certificate
              </button>
              <button
                type="button"
                onClick={() => setQrPhoneFormat('MOBILE_WEB_LINK')}
                className={`py-1.5 px-2 rounded-lg border font-medium transition-colors ${
                  qrPhoneFormat === 'MOBILE_WEB_LINK'
                    ? 'bg-sky-950/60 border-sky-600 text-sky-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Mobile Web Link
              </button>
              <button
                type="button"
                onClick={() => setQrPhoneFormat('CRYPTO_PAYLOAD')}
                className={`py-1.5 px-2 rounded-lg border font-medium transition-colors ${
                  qrPhoneFormat === 'CRYPTO_PAYLOAD'
                    ? 'bg-amber-950/60 border-amber-600 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Signed Hash
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 py-1">
              <QRCodeMatrix
                value={activeQrPayloadString}
                size={144}
                label={selectedPack?.serialNumber || 'SN-PACK'}
                allowDownload
              />

              <button
                type="button"
                onClick={() => setShowPhonePreviewModal(true)}
                className="w-full py-2 px-3 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-200 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                Preview What Customer Sees on Phone
              </button>

              <div className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 space-y-1">
                <span className="text-slate-400 font-sans block font-semibold">
                  Phone Camera Decoded Output ({qrPhoneFormat === 'PHONE_CERTIFICATE' ? 'Works Offline on Any Phone' : qrPhoneFormat}):
                </span>
                <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed text-emerald-300 max-h-28 overflow-y-auto">
                  {activeQrPayloadString}
                </pre>
              </div>
            </div>
          </div>

          {/* Safety Inspector / Regulator Enforcement Order Console */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Gavel className="w-4 h-4 text-amber-400" />
                  Safety Inspector Order Console
                </h3>
                <p className="text-[11px] text-slate-400">
                  Pass an official Inspector Quarantine or Class I Recall order on this batch
                </p>
              </div>
              <span
                className={`text-[11px] font-mono font-semibold ${
                  selectedBatch?.isRecalled || selectedBatch?.isQuarantined
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {selectedBatch?.isRecalled
                  ? 'RECALLED'
                  : selectedBatch?.isQuarantined
                  ? 'QUARANTINED'
                  : 'ACTIVE LOT'}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="inspector-order-reason"
                  className="block text-[11px] text-slate-400 mb-1"
                >
                  Inspector Enforcement Order / Reason
                </label>
                <input
                  id="inspector-order-reason"
                  type="text"
                  value={inspectorReason}
                  onChange={(e) => setInspectorReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                {onInspectorQuarantineBatch && selectedBatch && (
                  <button
                    type="button"
                    disabled={isInspectorBusy || selectedBatch.isRecalled}
                    onClick={handleInspectorQuarantineClick}
                    className={`w-full py-2 px-3 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 ${
                      selectedBatch.isQuarantined
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                        : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    } disabled:opacity-50`}
                  >
                    <Gavel className="w-3.5 h-3.5" />
                    {selectedBatch.isQuarantined
                      ? `Inspector: Lift Quarantine on ${selectedBatch.batchCode}`
                      : `Inspector: Quarantine Batch ${selectedBatch.batchCode}`}
                  </button>
                )}

                {onInspectorExecuteRecall && selectedBatch && !selectedBatch.isRecalled && (
                  <button
                    type="button"
                    disabled={isInspectorBusy}
                    onClick={handleInspectorRecallClick}
                    className="w-full py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Inspector: Execute 2-of-2 Class I Recall
                  </button>
                )}

                {selectedBatch && onOpenColdChainMonitor && (
                  <button
                    type="button"
                    onClick={() => onOpenColdChainMonitor(selectedBatch.batchId)}
                    className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-sky-300 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Thermometer className="w-3.5 h-3.5" />
                    Open Immutable Cold-Chain Ledger →
                  </button>
                )}

                {selectedBatch && onOpenRegulatorPortal && (
                  <button
                    type="button"
                    onClick={() => onOpenRegulatorPortal(selectedBatch.batchId)}
                    className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-300 font-medium text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Gavel className="w-3.5 h-3.5" />
                    Open Recall &amp; Safety Oversight →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Smartphone QR Verification Preview Modal */}
      {showPhonePreviewModal && selectedPack && selectedBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="phone-qr-preview-title"
        >
          <div className="w-full max-w-md bg-slate-900 border-2 border-slate-700 rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 id="phone-qr-preview-title" className="text-sm font-bold text-slate-100">
                    Customer Smartphone QR Scan Screen
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Live mobile verification certificate for {selectedPack.serialNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPhonePreviewModal(false)}
                aria-label="Close phone preview"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div
              className={`p-3.5 rounded-xl border ${
                forensicReport.overallStatus === 'AUTHENTIC_SAFE'
                  ? 'bg-emerald-950/40 border-emerald-600/70 text-emerald-100'
                  : 'bg-rose-950/50 border-rose-600/80 text-rose-100'
              }`}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider font-bold">
                {forensicReport.overallStatus === 'AUTHENTIC_SAFE'
                  ? 'VERIFIED AUTHENTIC & COLD-CHAIN SAFE'
                  : 'SAFETY / COUNTERFEIT ALERT BLOCKED'}
              </div>
              <div className="text-sm font-bold mt-1">{forensicReport.headline}</div>
              <p className="text-xs opacity-90 mt-1 leading-relaxed">{forensicReport.subheadline}</p>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 text-xs">
              {forensicReport.stages.map((st) => {
                const isAlert = st.stageStatus !== 'VERIFIED' && st.stageStatus !== 'PENDING';
                return (
                  <div
                    key={st.stageId}
                    className={`p-2.5 rounded-lg border ${
                      isAlert
                        ? 'bg-rose-950/30 border-rose-700/70'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-100">{st.stageTitle}</span>
                      <span className={isAlert ? 'text-rose-400 font-mono' : 'text-emerald-400 font-mono'}>
                        {st.stageStatus}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {st.actor} · {st.location}
                    </div>
                    <div className="text-[11px] font-mono text-slate-300 mt-0.5">
                      Temp:{' '}
                      {st.recordedTempC !== undefined
                        ? `${st.recordedTempC.toFixed(1)}°C (Safe ${st.safeRangeLabel})`
                        : st.safeRangeLabel}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[10px] text-slate-400 block mb-1">
                Decoded Phone QR Certificate Text:
              </span>
              <pre className="text-[10px] font-mono text-emerald-300 whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
                {phoneCertificateText}
              </pre>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowPhonePreviewModal(false);
                  onOpenCustomerVerify(selectedPack.serialNumber);
                }}
                className="flex-1 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg"
              >
                Open Full Verify Medicine Tab
              </button>
              <button
                type="button"
                onClick={() => setShowPhonePreviewModal(false)}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
              Each custody step stores the previous block’s hash (
              <span className="font-mono text-slate-300">parentBlockHash</span>). Altering past data
              invalidates every block after it.
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
                      hash:{' '}
                      {isFirst
                        ? shortHex(displayedGenesisHash, 10, 6)
                        : shortHex(blk.blockHash, 10, 6)}
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
                Five Solidity <span className="font-mono text-slate-300">0.8.24</span> contracts
                enforce strict rules—e.g. only verified wallets signed via EIP-712 can mint, ship,
                dispense, or recall.
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
              co-validate custody, and Class I recalls require a{' '}
              <strong className="text-slate-200">2-of-2 regulator quorum</strong>.
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
                  <span className="text-slate-500 font-sans block text-[11px]">
                    Batch Merkle Root
                  </span>
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
      <section
        aria-labelledby="arch-heading"
        className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5"
      >
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
              <li>
                Express gateway verifies signatures via <span className="font-mono">ecrecover</span>
              </li>
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
              <li>
                5 Solidity contracts (<span className="font-mono">MedSupplySentinel.sol</span> suite)
              </li>
              <li>Optional live Anvil / EVM RPC dual-write anchoring</li>
              <li>2-of-2 multi-sig recalls &amp; 2-of-3 Shamir recovery</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
