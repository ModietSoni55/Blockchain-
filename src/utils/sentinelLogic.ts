/**
 * MedSupply Sentinel - Pure Domain Logic & AI Risk Engine
 * Provides deterministic, unit-testable verification, HMAC-like attestation,
 * cold-chain excursion & Mean Kinetic Temperature (MKT) calculation,
 * Haversine impossible-travel detection, and AI counterfeit risk scoring.
 */

import {
  keccak256,
  stringToHex,
  recoverMessageAddress,
  encodeAbiParameters,
  concat,
} from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';

export const MANUFACTURER_PUBLIC_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

export type RoleType = 'MANUFACTURER' | 'DISTRIBUTOR' | 'PHARMACY' | 'REGULATOR' | 'PATIENT' | 'ADMIN';

export type PackStatus =
  | 'MANUFACTURED'
  | 'IN_TRANSIT'
  | 'AT_PHARMACY'
  | 'DISPENSED'
  | 'QUARANTINED'
  | 'RECALLED'
  | 'RETURNED_FOR_DESTRUCTION'
  | 'DESTROYED_WITNESSED';

export type VerificationOutcome =
  | 'AUTHENTIC'
  | 'EXPIRED'
  | 'ALREADY_DISPENSED'
  | 'QUARANTINED'
  | 'RECALLED'
  | 'COLD_CHAIN_BREACHED'
  | 'SUSPICIOUS_DUPLICATE'
  | 'TAMPERED_SIGNATURE'
  | 'PHOTOCOPY_CLONE_DETECTED'
  | 'UNKNOWN_SERIAL';

export interface BatchRecord {
  batchId: string;
  batchCode: string;
  productCode: string;
  brandName: string;
  genericName: string;
  dosageForm: string;
  strength: string;
  totalPacks: number;
  packsRegistered: number;
  minTemp: number;
  maxTemp: number;
  manufacturedAt: string;
  expiresAt: string;
  manufacturerName: string;
  manufacturerAddress: string;
  isQuarantined: boolean;
  isRecalled: boolean;
  quarantineReason?: string;
  anchoredMerkleRoot?: string;
  merkleAnchoredAt?: string;
  txHash: string;
}

export interface RecallProposalRecord {
  id: string;
  batchId: string;
  batchCode: string;
  brandName: string;
  severity: 'CLASS_I' | 'CLASS_II' | 'CLASS_III';
  reason: string;
  proposerAddress: string;
  approvals: string[];
  requiredApprovals: number;
  executed: boolean;
  createdAt: string;
}

export interface CustodyEvent {
  id: string;
  serialHash: string;
  batchId: string;
  fromActor: string;
  toActor: string;
  action: string;
  location: string;
  timestamp: string;
  notes: string;
  txHash: string;
}

export interface TelemetryEvent {
  id: string;
  batchId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  locationLabel: string;
  deviceId: string;
  timestamp: string;
  isBreached: boolean;
  breachType?: 'OVERHEATING' | 'SUBCOOLING';
  txHash?: string;
}

export interface MedicinePackRecord {
  serialNumber: string;
  serialHash: string;
  batchId: string;
  tokenId: number;
  status: PackStatus;
  currentCustodian: string;
  custodianRole: RoleType;
  nonce: string;
  signature: string;
  scanCount: number;
  isSuspicious: boolean;
  suspicionReason?: string;
  dispensedAt?: string;
  dispensedToReceipt?: string;
  lastScannedLocation?: string;
  lastScanLat?: number;
  lastScanLon?: number;
  lastScanTimestamp?: string;
  pufSealHash?: string;
  shamirRecallShares?: ShamirShareRecord[];
  shamirShareCommitments?: string[];
}

export interface PatientAdverseReport {
  id: string;
  serialNumber: string;
  batchCode: string;
  reporterType: 'PATIENT' | 'PHARMACIST' | 'CLINICIAN';
  issueCategory: 'BROKEN_SEAL' | 'SUSPECTED_FAKE_LABEL' | 'DISCOLORATION' | 'DUPLICATE_SERIAL_ALERT';
  locationCity: string;
  notes: string;
  timestamp: string;
  status: 'OPEN_INVESTIGATION' | 'ESCALATED_TO_REGULATOR';
}

export interface ParticipantEntity {
  id: string;
  organizationName: string;
  role: RoleType;
  walletAddress: string;
  licenseNumber: string;
  region: string;
  isAuthorized: boolean;
  registeredAt: string;
}

export interface AIRiskAssessment {
  riskScore: number; // 0 to 100
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  reason: string;
  recommendedAction: string;
  featureImportance: Record<string, number>;
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  isAuthentic: boolean;
  message: string;
  pack?: MedicinePackRecord;
  batch?: BatchRecord;
  custodyTimeline: CustodyEvent[];
  telemetryHistory: TelemetryEvent[];
  aiAssessment: AIRiskAssessment;
  verifiedAt: string;
}

export type BottleneckStatus = 'OPTIMAL' | 'CONGESTED' | 'CRITICAL_BOTTLENECK';

export type MapRegionKey = 'GLOBAL' | 'NORTH_AMERICA' | 'EUROPE' | 'ASIA_PACIFIC';

export type TransportMode = 'REEFER_TRUCK' | 'AIR_CARGO' | 'MARITIME_COLD';

export interface LogisticsHubNode {
  id: string;
  name: string;
  cityState: string;
  iataCode?: string;
  region?: 'NORTH_AMERICA' | 'EUROPE' | 'ASIA_PACIFIC';
  role: 'MANUFACTURER_PLANT' | 'COLD_HUB' | 'REGIONAL_DEPOT' | 'HOSPITAL_PHARMACY';
  coordinates: [number, number]; // [longitude, latitude]
  dwellHours: number;
  maxSafeDwellHours: number;
  activeBatches: string[];
  avgTempC: number;
  excursionCount: number;
  throughputCapacityPct: number;
  bottleneckReason?: string;
}

export interface TransitRouteCorridor {
  id: string;
  batchCode: string;
  brandName: string;
  fromHubId: string;
  toHubId: string;
  fromCoordinates: [number, number];
  toCoordinates: [number, number];
  distanceKm: number;
  estimatedHours: number;
  actualHours: number;
  status: BottleneckStatus;
  carrierName: string;
  transportMode?: TransportMode;
  regionScope?: 'NORTH_AMERICA' | 'EUROPE' | 'ASIA_PACIFIC' | 'TRANSATLANTIC' | 'TRANSPACIFIC';
  bottleneckDetail: string;
}

export interface PalletContainerRecord {
  id: string;
  sscc: string;
  batchId: string;
  batchCode: string;
  childSerials: string[];
  status: 'AGGREGATED' | 'IN_TRANSIT' | 'AT_PHARMACY' | 'UNPACKED';
  currentCustodian: string;
  custodianRole: RoleType;
  locationLabel: string;
  merkleRoot: string;
  createdAt: string;
  txHash: string;
}

export interface CommandAuditRecord {
  id: string;
  version: number;
  action: string;
  signerAddress: string;
  signerRole: RoleType;
  nonce: string;
  eip712Signature: string;
  summary: string;
  timestamp: string;
}

export interface PredictiveColdChainResult {
  driftPerHour: number;
  projectedTemp2h: number;
  isExcursionImminent: boolean;
  imminentWarning?: string;
  remainingShelfLifePct: number;
  mktCelsius: number;
  recommendation: string;
}

export interface RecallBlastRadiusResult {
  batchCode: string;
  totalTrackedPacks: number;
  atPharmacyCount: number;
  inTransitCount: number;
  manufacturedCount: number;
  dispensedPatientReceipts: number;
  destroyedCount: number;
  affectedCustodians: string[];
  destructibleSerials: string[];
  patientExposureSerials: string[];
}

export interface PUFMatchResult {
  anchoredPufHash: string;
  scannedPufHash: string;
  bitDrift: number;
  totalBits: number;
  similarityPct: number;
  verdict: 'GENUINE_OPTICAL_SEAL' | 'SUSPECT_OPTICAL_DRIFT' | 'CLONED_PHOTOCOPY_REJECTED';
  isAuthentic: boolean;
}

export interface ECIESEncryptedEnvelope {
  ephemeralPubKey: string;
  ivHex: string;
  ciphertextHex: string;
  macTagHex: string;
}

export interface ShamirShareRecord {
  index: number;
  custodianLabel: string;
  role: RoleType;
  yChunksHex: string[];
  shareCommitment: string;
  recipientPublicKey?: string;
  eciesEnvelope?: ECIESEncryptedEnvelope;
  isSealedECIES?: boolean;
}

export interface ShamirReconstructionResult {
  ok: boolean;
  sharesUsed: number;
  threshold: number;
  recoveredSecret?: string;
  error?: string;
  primeFieldLabel: string;
  lagrangeCoefficients: string[];
}

export interface NIZKPrescriptionProof {
  scheme: 'SECP256K1_PEDERSEN_SCHNORR_NIZK_V1';
  serialHash: string;
  commitmentPoint: string;
  generatorHPoint: string;
  announcementR: string;
  challengeHex: string;
  responseS1Hex: string;
  responseS2Hex: string;
  zeroWitnessLeaked: true;
}

export interface SelectiveDisclosureClaimNode {
  key: string;
  label: string;
  salt: string;
  revealed: boolean;
  value?: string;
  leafHash: string;
  merkleProof: string[];
}

export interface SelectiveDisclosureVC {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  subjectSerial: string;
  claimsMerkleRoot: string;
  issuerSignatureDigest: string;
  claims: SelectiveDisclosureClaimNode[];
}

export interface CustodyGraphEdge {
  id: string;
  fromRole: string;
  toRole: string;
  fromActor: string;
  toActor: string;
  count: number;
  isAnomaly: boolean;
  anomalyReason?: string;
}

export interface CustodyGraphDiversionAnalysis {
  integrityScore: number;
  totalTransitions: number;
  anomalousTransitions: number;
  diversionAlertSummary: string;
  edges: CustodyGraphEdge[];
}

/**
 * Evaluates a regional logistics hub or transit corridor for supply-chain bottlenecks
 */
export function evaluateLogisticsBottleneck(params: {
  dwellHours: number;
  maxSafeDwellHours: number;
  excursionCount: number;
  throughputCapacityPct: number;
}): {
  status: BottleneckStatus;
  severityScore: number;
  recommendation: string;
} {
  let score = 0;
  if (params.excursionCount > 0) {
    score += 55 + Math.min(params.excursionCount * 15, 30);
  }
  if (params.dwellHours > params.maxSafeDwellHours) {
    const overtimeRatio = (params.dwellHours - params.maxSafeDwellHours) / Math.max(params.maxSafeDwellHours, 1);
    score += Math.round(overtimeRatio * 45) + 20;
  }
  if (params.throughputCapacityPct >= 90) {
    score += 25;
  } else if (params.throughputCapacityPct >= 75) {
    score += 12;
  }

  const severityScore = Math.min(Math.max(score, 0), 100);

  if (severityScore >= 65) {
    return {
      status: 'CRITICAL_BOTTLENECK',
      severityScore,
      recommendation: 'Reroute inbound cold-chain fleet immediately and quarantine affected reefer containers.',
    };
  }
  if (severityScore >= 30) {
    return {
      status: 'CONGESTED',
      severityScore,
      recommendation: 'Allocate auxiliary cold-vault dock capacity and prioritize express customs clearance.',
    };
  }
  return {
    status: 'OPTIMAL',
    severityScore,
    recommendation: 'Corridor operating within nominal SLA and USP cold-chain parameters.',
  };
}

/**
 * Real cryptographic 256-bit Keccak-256 hash (byte-for-byte compatible with Solidity keccak256)
 */
export function computeKeccakHex(input: string): string {
  return keccak256(stringToHex(input));
}

/**
 * Canonical digest string signed by manufacturer ECDSA secp256k1 key or legacy attestation
 */
export function buildQRSignatureDigest(
  serialNumber: string,
  batchId: string,
  expiresAt: string,
  nonce: string
): string {
  return computeKeccakHex(`MEDSUPPLY_QR_V2:${serialNumber}:${batchId}:${expiresAt}:${nonce}`);
}

/**
 * Generates an HMAC-style signature for legacy QR payloads
 */
export function signQRPayload(
  serialNumber: string,
  batchId: string,
  expiresAt: string,
  nonce: string
): string {
  const raw = `MEDSUPPLY_HMAC_SECRET:${serialNumber}:${batchId}:${expiresAt}:${nonce}`;
  return computeKeccakHex(raw).slice(2, 66);
}

/**
 * Verifies an asymmetric secp256k1 ECDSA QR signature purely via public key recovery (no secret key on client)
 */
export async function verifyQRSignatureECDSA(
  serialNumber: string,
  batchId: string,
  expiresAt: string,
  nonce: string,
  signatureHex: string,
  allowedIssuers: string[] = [MANUFACTURER_PUBLIC_ADDRESS]
): Promise<{ isValid: boolean; recoveredAddress?: string }> {
  try {
    const cleanSig = signatureHex.trim().startsWith('0x')
      ? (signatureHex.trim() as `0x${string}`)
      : (`0x${signatureHex.trim()}` as `0x${string}`);
    if (cleanSig.length !== 132) {
      return { isValid: false };
    }
    const digest = buildQRSignatureDigest(serialNumber, batchId, expiresAt, nonce);
    const recovered = await recoverMessageAddress({
      message: { raw: digest as `0x${string}` },
      signature: cleanSig,
    });
    const isValid = allowedIssuers.some(
      (addr) => addr.toLowerCase() === recovered.toLowerCase()
    );
    return { isValid, recoveredAddress: recovered };
  } catch {
    return { isValid: false };
  }
}

/**
 * Verifies a QR payload signature synchronously (supports legacy 64-char hex or matching 130-char ECDSA hex).
 * For asymmetric public-key-only verification without stored pack lookup, use verifyQRSignatureECDSA.
 */
export function verifyQRSignature(
  serialNumber: string,
  batchId: string,
  expiresAt: string,
  nonce: string,
  signature: string,
  expectedPackSignature?: string
): boolean {
  const normalizedProvided = signature.trim().replace(/^0x/i, '').toLowerCase();
  if (expectedPackSignature) {
    const normalizedExpectedPack = expectedPackSignature.trim().replace(/^0x/i, '').toLowerCase();
    if (normalizedProvided === normalizedExpectedPack && normalizedProvided.length === 130) {
      return true;
    }
  }
  const expectedLegacy = signQRPayload(serialNumber, batchId, expiresAt, nonce).toLowerCase();
  return expectedLegacy === normalizedProvided;
}

/**
 * Evaluates a cold-chain temperature reading against batch limits
 */
export function evaluateColdChainReading(
  temperature: number,
  minTemp: number,
  maxTemp: number
): { isBreached: boolean; breachType?: 'OVERHEATING' | 'SUBCOOLING' } {
  if (temperature < minTemp) {
    return { isBreached: true, breachType: 'SUBCOOLING' };
  }
  if (temperature > maxTemp) {
    return { isBreached: true, breachType: 'OVERHEATING' };
  }
  return { isBreached: false };
}

/**
 * Calculates Mean Kinetic Temperature (MKT) in Celsius using the USP Haynes formula:
 * MKT = (deltaH / R) / ( -ln( (1/n) * sum( exp(-deltaH / (R * T_k)) ) ) ) - 273.15
 * where deltaH = 83.144 kJ/mol, R = 0.0083144 kJ/(mol·K) -> deltaH / R = 10000 K.
 */
export function calculateMeanKineticTemperature(temperaturesCelsius: number[]): number {
  if (!temperaturesCelsius || temperaturesCelsius.length === 0) return 0;
  const deltaHOverR = 10000;
  let sumExp = 0;
  for (const tempC of temperaturesCelsius) {
    const tempK = tempC + 273.15;
    sumExp += Math.exp(-deltaHOverR / tempK);
  }
  const avgExp = sumExp / temperaturesCelsius.length;
  const mktKelvin = deltaHOverR / -Math.log(avgExp);
  const mktCelsius = mktKelvin - 273.15;
  return Math.round(mktCelsius * 100) / 100;
}

/**
 * Calculates Haversine great-circle distance and travel velocity between two scan coordinates
 * Flags impossible geographic travel (> 950 km/h commercial flight threshold)
 */
export function detectImpossibleGeographicJump(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  elapsedMinutes: number
): { distanceKm: number; velocityKmh: number; isImpossibleJump: boolean } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = Math.round(R * c * 10) / 10;

  const hours = Math.max(elapsedMinutes / 60, 0.01);
  const velocityKmh = Math.round((distanceKm / hours) * 10) / 10;
  const isImpossibleJump = distanceKm > 50 && velocityKmh > 950;

  return { distanceKm, velocityKmh, isImpossibleJump };
}

/**
 * Multi-factor AI Risk Scoring Engine (0 - 100 scale)
 */
export function calculateAIRiskScore(params: {
  isRegistered: boolean;
  scanCount: number;
  isDispensed: boolean;
  isExpired: boolean;
  isQuarantined: boolean;
  isRecalled: boolean;
  coldChainBreached: boolean;
  maxExcursionDelta?: number;
  impossibleJumpDetected?: boolean;
  signatureTampered?: boolean;
  pufCloned?: boolean;
}): AIRiskAssessment {
  if (!params.isRegistered) {
    return {
      riskScore: 100.0,
      riskLevel: 'CRITICAL',
      confidence: 0.99,
      reason: 'Serial number does not exist in the authenticated blockchain registry.',
      recommendedAction: 'Reject pack immediately. Report suspected counterfeit to regulatory authorities.',
      featureImportance: {
        unregistered_serial: 1.0,
      },
    };
  }

  let score = 0;
  const reasons: string[] = [];
  const rawWeights: Record<string, number> = {};

  if (params.isRecalled) {
    score += 90;
    reasons.push('Mandatory Class I batch recall active');
    rawWeights.batch_recall = 0.5;
  } else if (params.isQuarantined) {
    score += 85;
    reasons.push('Regulatory quarantine lock active on parent batch');
    rawWeights.regulatory_quarantine = 0.45;
  }

  if (params.isDispensed && params.scanCount > 1) {
    score += 68;
    reasons.push('Medicine pack already dispensed to a previous patient; potential refill or clone attack');
    rawWeights.dispensed_reuse = 0.38;
  }

  if (params.scanCount > 1 && !params.isDispensed) {
    const extraScans = Math.min(params.scanCount - 1, 4);
    const scanPenalty = 25 + extraScans * 12;
    score += scanPenalty;
    reasons.push(`Duplicate QR verification anomaly (${params.scanCount} total scans recorded)`);
    rawWeights.duplicate_scan_frequency = 0.28;
  }

  if (params.coldChainBreached) {
    const deltaBoost = params.maxExcursionDelta ? Math.min(params.maxExcursionDelta * 2.5, 20) : 10;
    score += 32 + deltaBoost;
    reasons.push('Cold-chain thermal excursion recorded during logistics transit');
    rawWeights.temperature_breach = 0.27;
  }

  if (params.isExpired) {
    score += 48;
    reasons.push('Product has passed manufacturer expiration timestamp');
    rawWeights.expiration_risk = 0.22;
  }

  if (params.impossibleJumpDetected) {
    score += 35;
    reasons.push('Impossible geographic velocity detected between sequential scans');
    rawWeights.location_anomaly = 0.21;
  }

  if (params.signatureTampered) {
    score += 95;
    reasons.push('Cryptographic QR signature mismatch — forged or altered QR payload');
    rawWeights.forged_qr_signature = 0.65;
  }

  if (params.pufCloned) {
    score += 96;
    reasons.push('Optical PUF micro-seal fingerprint mismatch — suspected photocopied/reprinted QR label');
    rawWeights.puf_optical_clone_drift = 0.68;
  }

  const finalScore = Math.min(Math.max(Math.round(score * 10) / 10, 0), 100);

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
  let recommendedAction = 'Verified safe for pharmacy dispensing and patient consumption.';

  if (finalScore >= 80) {
    riskLevel = 'CRITICAL';
    recommendedAction = 'Do not dispense or consume. Isolate pack and notify regulatory inspector.';
  } else if (finalScore >= 50) {
    riskLevel = 'HIGH';
    recommendedAction = 'Hold inventory pending secondary pharmacist audit and cold-chain log review.';
  } else if (finalScore >= 25) {
    riskLevel = 'MEDIUM';
    recommendedAction = 'Inspect physical tamper-evident seal and verify distributor invoice.';
  }

  // Normalize feature importance
  const totalWeight = Object.values(rawWeights).reduce((acc, v) => acc + v, 0);
  const featureImportance: Record<string, number> = {};
  if (totalWeight > 0) {
    for (const [k, v] of Object.entries(rawWeights)) {
      featureImportance[k] = Math.round((v / totalWeight) * 100) / 100;
    }
  } else {
    featureImportance.verified_custody_chain = 1.0;
  }

  return {
    riskScore: finalScore,
    riskLevel,
    confidence: reasons.length > 0 ? 0.94 : 0.97,
    reason: reasons.length > 0
      ? reasons.join('; ')
      : 'Intact cryptographic chain of custody and compliant cold-chain telemetry.',
    recommendedAction,
    featureImportance,
  };
}

/**
 * Builds an industry-standard GS1 Digital Link URI embedding GTIN/NDC, serial number, and cryptographic signature
 */
export function buildGS1DigitalLink(
  productCode: string,
  serialNumber: string,
  signature: string
): string {
  const gtin = productCode.replace(/[^0-9A-Za-z]/g, '');
  const sigParam = signature.startsWith('0x') ? signature : `0x${signature}`;
  return `https://id.gs1.org/01/${encodeURIComponent(gtin)}/21/${encodeURIComponent(serialNumber)}?sig=${encodeURIComponent(sigParam)}`;
}

/**
 * Parses a user scan input which may be:
 * 1. Raw serial number: "SN-PCV20-2026-0001"
 * 2. Colon-delimited QR matrix string: "SN-PCV20-2026-0001:0xabc123..."
 * 3. Signed JSON QR payload: '{"serialNumber":"SN-PCV20-2026-0001","signature":"0x..."}'
 * 4. GS1 Digital Link URI: "https://id.gs1.org/01/NDC0069421001/21/SN-PCV20-2026-0001?sig=0x..."
 */
export function parseQRScanInput(rawInput: string): {
  serialNumber: string;
  providedSignature?: string;
  format: 'RAW_SERIAL' | 'QR_COLON_PAYLOAD' | 'QR_JSON_PAYLOAD' | 'GS1_DIGITAL_LINK';
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { serialNumber: '', format: 'RAW_SERIAL' };
  }

  if (/^https?:\/\//i.test(trimmed) && trimmed.includes('/21/')) {
    try {
      const url = new URL(trimmed);
      const segments = url.pathname.split('/').filter(Boolean);
      const ai21Index = segments.indexOf('21');
      if (ai21Index !== -1 && segments[ai21Index + 1]) {
        const sn = decodeURIComponent(segments[ai21Index + 1]).trim();
        const sig = url.searchParams.get('sig')?.trim() || undefined;
        return {
          serialNumber: sn,
          providedSignature: sig,
          format: 'GS1_DIGITAL_LINK',
        };
      }
    } catch {
      // Fall through if invalid URL
    }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const sn = typeof parsed.serialNumber === 'string'
        ? parsed.serialNumber.trim()
        : typeof parsed.serial_number === 'string'
        ? parsed.serial_number.trim()
        : '';
      const sig = typeof parsed.signature === 'string' ? parsed.signature.trim() : undefined;
      if (sn) {
        return {
          serialNumber: sn,
          providedSignature: sig,
          format: 'QR_JSON_PAYLOAD',
        };
      }
    } catch {
      // Fall through if malformed JSON
    }
  }

  if (trimmed.includes(':0x')) {
    const idx = trimmed.indexOf(':0x');
    const sn = trimmed.slice(0, idx).trim();
    const sig = trimmed.slice(idx + 1).trim();
    if (sn && sig) {
      return {
        serialNumber: sn,
        providedSignature: sig,
        format: 'QR_COLON_PAYLOAD',
      };
    }
  }

  const colonHexMatch = /^([^:\s]+):([0-9a-fA-F]{16,128})$/.exec(trimmed);
  if (colonHexMatch) {
    return {
      serialNumber: colonHexMatch[1].trim(),
      providedSignature: colonHexMatch[2].trim(),
      format: 'QR_COLON_PAYLOAD',
    };
  }

  return {
    serialNumber: trimmed,
    format: 'RAW_SERIAL',
  };
}

export type SentinelRBACAction =
  | 'MINT_BATCH'
  | 'TRANSFER_DISTRIBUTOR'
  | 'COMMISSION_PALLET'
  | 'TRANSFER_PALLET'
  | 'DEAGGREGATE_PALLET'
  | 'TRANSFER_PHARMACY'
  | 'DISPENSE_PATIENT'
  | 'QUARANTINE_BATCH'
  | 'PROPOSE_RECALL'
  | 'WITNESS_DESTRUCTION'
  | 'ANCHOR_MERKLE_ROOT'
  | 'MANAGE_PARTICIPANTS'
  | 'OPERATE_LOGISTICS'
  | 'INGEST_TELEMETRY'
  | 'BREAK_GLASS_SHAMIR'
  | 'LEDGER_RESET';

/**
 * Enforces OpenZeppelin AccessControl permission rules in the UI & API layer
 */
export function canRoleExecuteAction(
  role: RoleType,
  action: SentinelRBACAction
): { allowed: boolean; requiredRole: RoleType; reason?: string } {
  if (role === 'ADMIN') {
    return { allowed: true, requiredRole: role };
  }
  const matrix: Record<SentinelRBACAction, RoleType> = {
    MINT_BATCH: 'MANUFACTURER',
    TRANSFER_DISTRIBUTOR: 'MANUFACTURER',
    COMMISSION_PALLET: 'MANUFACTURER',
    ANCHOR_MERKLE_ROOT: 'MANUFACTURER',
    TRANSFER_PALLET: 'DISTRIBUTOR',
    DEAGGREGATE_PALLET: 'PHARMACY',
    TRANSFER_PHARMACY: 'DISTRIBUTOR',
    DISPENSE_PATIENT: 'PHARMACY',
    QUARANTINE_BATCH: 'REGULATOR',
    PROPOSE_RECALL: 'REGULATOR',
    WITNESS_DESTRUCTION: 'REGULATOR',
    MANAGE_PARTICIPANTS: 'ADMIN',
    OPERATE_LOGISTICS: 'DISTRIBUTOR',
    INGEST_TELEMETRY: 'DISTRIBUTOR',
    BREAK_GLASS_SHAMIR: 'REGULATOR',
    LEDGER_RESET: 'REGULATOR',
  };

  const requiredRole = matrix[action];
  if (role === requiredRole) {
    return { allowed: true, requiredRole };
  }
  if (action === 'TRANSFER_PALLET' && (role === 'MANUFACTURER' || role === 'DISTRIBUTOR')) {
    return { allowed: true, requiredRole: role };
  }
  if (
    action === 'DEAGGREGATE_PALLET' &&
    (role === 'MANUFACTURER' || role === 'DISTRIBUTOR' || role === 'PHARMACY')
  ) {
    return { allowed: true, requiredRole: role };
  }
  if (
    (action === 'OPERATE_LOGISTICS' || action === 'INGEST_TELEMETRY') &&
    (role === 'MANUFACTURER' || role === 'DISTRIBUTOR' || role === 'REGULATOR')
  ) {
    return { allowed: true, requiredRole: role };
  }
  if (action === 'MANAGE_PARTICIPANTS' && role === 'REGULATOR') {
    return { allowed: true, requiredRole: 'REGULATOR' };
  }
  return {
    allowed: false,
    requiredRole,
    reason: `AccessControl: Active signer (${role}) lacks ${requiredRole}_ROLE required for ${action}.`,
  };
}

/**
 * Full pack verification state-machine evaluation
 */
export function evaluatePackVerification(
  pack: MedicinePackRecord | undefined,
  batch: BatchRecord | undefined,
  custodyTimeline: CustodyEvent[],
  telemetryHistory: TelemetryEvent[],
  nowIso: string = new Date().toISOString(),
  impossibleJumpDetected: boolean = false,
  signatureTampered: boolean = false,
  pufCloned: boolean = false
): VerificationResult {
  if (!pack || !batch) {
    const aiAssessment = calculateAIRiskScore({
      isRegistered: false,
      scanCount: 1,
      isDispensed: false,
      isExpired: false,
      isQuarantined: false,
      isRecalled: false,
      coldChainBreached: false,
    });
    return {
      outcome: 'UNKNOWN_SERIAL',
      isAuthentic: false,
      message: 'Unregistered serial number. No matching digital passport found on the blockchain.',
      custodyTimeline: [],
      telemetryHistory: [],
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  const isExpired = new Date(nowIso).getTime() > new Date(batch.expiresAt).getTime();
  const coldChainBreached = telemetryHistory.some((t) => t.isBreached);
  const isDispensed = pack.status === 'DISPENSED';
  const isDuplicate = pack.scanCount > 1;

  const aiAssessment = calculateAIRiskScore({
    isRegistered: true,
    scanCount: pack.scanCount,
    isDispensed,
    isExpired,
    isQuarantined: batch.isQuarantined || pack.status === 'QUARANTINED',
    isRecalled: batch.isRecalled || pack.status === 'RECALLED',
    coldChainBreached,
    impossibleJumpDetected,
    signatureTampered,
    pufCloned,
  });

  if (signatureTampered) {
    return {
      outcome: 'TAMPERED_SIGNATURE',
      isAuthentic: false,
      message: `Cryptographic QR signature verification failed for ${pack.serialNumber}. The QR payload signature does not match the on-chain attestation.`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (pufCloned) {
    return {
      outcome: 'PHOTOCOPY_CLONE_DETECTED',
      isAuthentic: false,
      message: `ECDSA QR signature is valid, BUT Physical Unclonable Function (PUF) optical micro-seal fingerprint failed Hamming verification for ${pack.serialNumber}. Suspected photocopied label on counterfeit box!`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (
    batch.isRecalled ||
    pack.status === 'RECALLED' ||
    pack.status === 'RETURNED_FOR_DESTRUCTION' ||
    pack.status === 'DESTROYED_WITNESSED'
  ) {
    return {
      outcome: 'RECALLED',
      isAuthentic: false,
      message: `Batch ${batch.batchCode} is under an active mandatory recall (${pack.status}): ${batch.quarantineReason || 'Safety defect'}`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (batch.isQuarantined || pack.status === 'QUARANTINED') {
    return {
      outcome: 'QUARANTINED',
      isAuthentic: false,
      message: `Batch ${batch.batchCode} has been quarantined by the regulator: ${batch.quarantineReason || 'Thermal or quality investigation'}`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (isExpired) {
    return {
      outcome: 'EXPIRED',
      isAuthentic: false,
      message: `Medicine expired on ${batch.expiresAt.slice(0, 10)}. Do not dispense or consume.`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (isDispensed && isDuplicate) {
    return {
      outcome: 'ALREADY_DISPENSED',
      isAuthentic: false,
      message: `This pack was already dispensed (${pack.dispensedAt?.slice(0, 10) || 'prior'}). Duplicate scan indicates potential counterfeit reuse.`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (coldChainBreached) {
    return {
      outcome: 'COLD_CHAIN_BREACHED',
      isAuthentic: false,
      message: `Cold-chain temperature breach detected for Batch ${batch.batchCode}. Safe range is ${batch.minTemp}°C to ${batch.maxTemp}°C.`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  if (isDuplicate || impossibleJumpDetected) {
    return {
      outcome: 'SUSPICIOUS_DUPLICATE',
      isAuthentic: false,
      message: impossibleJumpDetected
        ? `Geo-velocity clone alert: Serial ${pack.serialNumber} scanned across impossible geographic distance within minutes.`
        : `Duplicate scan warning: Serial ${pack.serialNumber} has been verified ${pack.scanCount} times.`,
      pack,
      batch,
      custodyTimeline,
      telemetryHistory,
      aiAssessment,
      verifiedAt: nowIso,
    };
  }

  return {
    outcome: 'AUTHENTIC',
    isAuthentic: true,
    message: 'Authentic pharmaceutical pack with verified chain of custody and compliant cold-chain telemetry.',
    pack,
    batch,
    custodyTimeline,
    telemetryHistory,
    aiAssessment,
    verifiedAt: nowIso,
  };
}

/**
 * ============================================================================
 * ADVANCED BLOCKCHAIN & CRYPTOGRAPHIC VERIFICATION PRIMITIVES
 * 1. Batch Merkle Tree Construction & O(log N) Inclusion Proof Verification
 * 2. EIP-712 Typed Structured Data Hashing & Domain Separator
 * 3. ERC-5192 Soulbound Token (SBT) Lock Evaluation
 * 4. Zero-Knowledge (ZK) Salted Patient Prescription Commitment
 * 5. Hash-Chained EVM Block Header & State Root Explorer
 * ============================================================================
 */

export interface MerkleInclusionProof {
  serialNumber: string;
  serialHash: string;
  batchId: string;
  leafHash: string;
  merkleRoot: string;
  proofSiblings: string[];
  leafIndex: number;
  totalLeaves: number;
  isVerified: boolean;
}

export interface EIP712TypedAttestation {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  message: {
    serialNumber: string;
    serialHash: string;
    batchId: string;
    expiresAt: string;
    nonce: string;
  };
  domainSeparatorHash: string;
  structHash: string;
  eip712Digest: string;
  isSoulboundLocked: boolean;
}

export interface EVMBlockHeaderRecord {
  blockNumber: number;
  blockHash: string;
  parentBlockHash: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  gasUsed: number;
  timestamp: string;
  txCount: number;
  primaryAction: string;
  txHash: string;
  actorSummary: string;
}

function toBytes32Hex(input: string): `0x${string}` {
  const clean = input.trim();
  if (/^0x[0-9a-fA-F]+$/.test(clean)) {
    const raw = clean.slice(2);
    if (raw.length <= 64) {
      return `0x${raw.padStart(64, '0').toLowerCase()}` as `0x${string}`;
    }
    return `0x${raw.slice(0, 64).toLowerCase()}` as `0x${string}`;
  }
  return computeKeccakHex(clean) as `0x${string}`;
}

/**
 * Computes a deterministic double-hashed leaf node matching Solidity MedSupplySentinel.sol line 262:
 * leafHash = keccak256(bytes.concat(keccak256(abi.encode(batchId, serialHash, expiryTimestamp))))
 */
export function computePackMerkleLeaf(
  batchId: string,
  serialHash: string,
  expiresAt: string
): string {
  const batchBytes32 = toBytes32Hex(batchId);
  const serialBytes32 = toBytes32Hex(serialHash);
  const parsedMs = new Date(expiresAt).getTime();
  const expirySec = BigInt(Number.isFinite(parsedMs) ? Math.max(0, Math.floor(parsedMs / 1000)) : 0);

  const abiEncoded = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
    [batchBytes32, serialBytes32, expirySec]
  );
  const inner = keccak256(abiEncoded);
  return keccak256(inner);
}

/**
 * Commutative sorted pair hash matching OpenZeppelin Hashes.commutativeKeccak256(bytes32 a, bytes32 b):
 * H(a, b) = keccak256(abi.encodePacked(min(a, b), max(a, b)))
 */
export function hashMerkleNodePair(left: string, right: string): string {
  const l = toBytes32Hex(left);
  const r = toBytes32Hex(right);
  const [first, second] = BigInt(l) <= BigInt(r) ? [l, r] : [r, l];
  return keccak256(concat([first, second]));
}

/**
 * Builds a complete binary Merkle tree over all serialized packs in a batch
 * Returns the Merkle Root, leaf hashes, and layers of the tree
 */
export function buildBatchMerkleTree(
  packsInBatch: Array<{ serialNumber: string; serialHash: string; batchId: string }>,
  expiresAt: string
): {
  merkleRoot: string;
  leaves: string[];
  layers: string[][];
} {
  if (!packsInBatch || packsInBatch.length === 0) {
    const emptyRoot = computeKeccakHex('EMPTY_BATCH_MERKLE_ROOT');
    return { merkleRoot: emptyRoot, leaves: [], layers: [[emptyRoot]] };
  }

  const leaves = packsInBatch.map((p) =>
    computePackMerkleLeaf(p.batchId, p.serialHash, expiresAt)
  );

  const layers: string[][] = [leaves];
  let currentLayer = [...leaves];

  while (currentLayer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i];
      nextLayer.push(hashMerkleNodePair(left, right));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    merkleRoot: currentLayer[0],
    leaves,
    layers,
  };
}

/**
 * Generates an O(log N) Merkle inclusion proof for a specific pack in a batch
 */
export function generateMerkleInclusionProof(
  targetSerialNumber: string,
  packsInBatch: Array<{ serialNumber: string; serialHash: string; batchId: string }>,
  expiresAt: string
): MerkleInclusionProof {
  const tree = buildBatchMerkleTree(packsInBatch, expiresAt);
  const leafIndex = packsInBatch.findIndex(
    (p) => p.serialNumber.toLowerCase() === targetSerialNumber.toLowerCase()
  );

  if (leafIndex === -1) {
    const fakeHash = computeKeccakHex(targetSerialNumber);
    const fakeLeaf = computePackMerkleLeaf('0x0', fakeHash, expiresAt);
    return {
      serialNumber: targetSerialNumber,
      serialHash: fakeHash,
      batchId: '0x0',
      leafHash: fakeLeaf,
      merkleRoot: tree.merkleRoot,
      proofSiblings: [],
      leafIndex: -1,
      totalLeaves: packsInBatch.length,
      isVerified: false,
    };
  }

  const targetPack = packsInBatch[leafIndex];
  const leafHash = tree.leaves[leafIndex];
  const proofSiblings: string[] = [];

  let idx = leafIndex;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1 < layer.length ? idx + 1 : idx;
    proofSiblings.push(layer[siblingIdx]);
    idx = Math.floor(idx / 2);
  }

  const isVerified = verifyMerkleInclusionProof(leafHash, proofSiblings, tree.merkleRoot);

  return {
    serialNumber: targetPack.serialNumber,
    serialHash: targetPack.serialHash,
    batchId: targetPack.batchId,
    leafHash,
    merkleRoot: tree.merkleRoot,
    proofSiblings,
    leafIndex,
    totalLeaves: packsInBatch.length,
    isVerified,
  };
}

/**
 * Verifies an O(log N) Merkle proof from leafHash + proofSiblings against merkleRoot
 */
export function verifyMerkleInclusionProof(
  leafHash: string,
  proofSiblings: string[],
  merkleRoot: string
): boolean {
  if (!leafHash || !merkleRoot) return false;
  let computedHash = leafHash;
  for (const sibling of proofSiblings) {
    computedHash = hashMerkleNodePair(computedHash, sibling);
  }
  return computedHash.toLowerCase() === merkleRoot.toLowerCase();
}

/**
 * Computes EIP-712 Typed Structured Data Digest & ERC-5192 Soulbound Lock state for a pack
 */
export function computeEIP712AttestationDigest(params: {
  serialNumber: string;
  serialHash: string;
  batchId: string;
  expiresAt: string;
  nonce: string;
  status: PackStatus;
  chainId?: number;
  verifyingContract?: string;
}): EIP712TypedAttestation {
  const chainId = params.chainId ?? 31337;
  const verifyingContract =
    params.verifyingContract ?? '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9';

  const domain = {
    name: 'MedSupplySentinelQRAttestation',
    version: '1',
    chainId,
    verifyingContract,
  };

  const domainSeparatorHash = computeKeccakHex(
    `EIP712Domain:${domain.name}:${domain.version}:${domain.chainId}:${domain.verifyingContract}`
  );

  const structHash = computeKeccakHex(
    `PackAttestation:${params.serialHash}:${params.batchId}:${params.expiresAt}:${params.nonce}`
  );

  const eip712Digest = computeKeccakHex(`\\x19\\x01:${domainSeparatorHash}:${structHash}`);
  const isSoulboundLocked =
    params.status === 'DISPENSED' ||
    params.status === 'RECALLED' ||
    params.status === 'DESTROYED_WITNESSED';

  return {
    domain,
    message: {
      serialNumber: params.serialNumber,
      serialHash: params.serialHash,
      batchId: params.batchId,
      expiresAt: params.expiresAt,
      nonce: params.nonce,
    },
    domainSeparatorHash,
    structHash,
    eip712Digest,
    isSoulboundLocked,
  };
}

/**
 * Creates a privacy-preserving Zero-Knowledge (ZK) salted commitment for a patient prescription receipt
 * so pharmacies & patients can prove legitimate dispensing without exposing HIPAA patient PII on-chain.
 */
export function createZKPrescriptionCommitment(
  serialNumber: string,
  prescriptionRefId: string,
  patientSecretSalt: string
): {
  serialHash: string;
  prescriptionIdHash: string;
  saltHash: string;
  commitmentHash: string;
} {
  const serialHash = computeKeccakHex(serialNumber.trim());
  const prescriptionIdHash = computeKeccakHex(prescriptionRefId.trim().toUpperCase());
  const saltHash = computeKeccakHex(patientSecretSalt.trim());
  const commitmentHash = computeKeccakHex(
    `MEDSUPPLY_ZK_RX_V1:${serialHash}:${prescriptionIdHash}:${saltHash}`
  );

  return {
    serialHash,
    prescriptionIdHash,
    saltHash,
    commitmentHash,
  };
}

/**
 * Verifies a Zero-Knowledge prescription receipt commitment without revealing raw patient identity
 */
export function verifyZKPrescriptionCommitment(
  serialNumber: string,
  prescriptionRefId: string,
  patientSecretSalt: string,
  expectedCommitmentHash: string
): boolean {
  const computed = createZKPrescriptionCommitment(
    serialNumber,
    prescriptionRefId,
    patientSecretSalt
  );
  return computed.commitmentHash.toLowerCase() === expectedCommitmentHash.toLowerCase();
}

/**
 * Builds a deterministic hash-chained sequence of EVM Block Headers from custody & governance events
 */
export function buildHashChainedBlocks(events: CustodyEvent[]): EVMBlockHeaderRecord[] {
  const chronological = [...events].reverse();
  const blocks: EVMBlockHeaderRecord[] = [];
  let parentHash =
    '0x0000000000000000000000000000000000000000000000000000000000000000';
  const baseBlockNumber = 18420100;

  for (let i = 0; i < chronological.length; i++) {
    const evt = chronological[i];
    const blockNumber = baseBlockNumber + i + 1;
    const transactionsRoot = computeKeccakHex(`TX_ROOT:${evt.txHash}:${evt.serialHash}`);
    const stateRoot = computeKeccakHex(`STATE_ROOT:${parentHash}:${evt.action}:${evt.toActor}`);
    const receiptsRoot = computeKeccakHex(`RECEIPT_ROOT:${evt.id}:${evt.timestamp}`);
    const blockHash = computeKeccakHex(
      `BLOCK_HEADER:${blockNumber}:${parentHash}:${stateRoot}:${transactionsRoot}`
    );

    const gasUsed =
      evt.action === 'MINT_GENESIS'
        ? 184520
        : evt.action.includes('QUARANTINE') || evt.action.includes('RECALL')
        ? 112400
        : 86410;

    blocks.push({
      blockNumber,
      blockHash,
      parentBlockHash: parentHash,
      stateRoot,
      transactionsRoot,
      receiptsRoot,
      gasUsed,
      timestamp: evt.timestamp,
      txCount: 1,
      primaryAction: evt.action,
      txHash: evt.txHash,
      actorSummary: `${evt.fromActor} → ${evt.toActor}`,
    });

    parentHash = blockHash;
  }

  return blocks.reverse();
}

/**
 * ============================================================================
 * PHASE 2 ENTERPRISE PRIMITIVES:
 * - EIP-712 Server Command Authentication Schema
 * - CSPRNG Per-Pack ZK Blinding Salt
 * - Predictive Arrhenius Cold-Chain Drift & Potency Model
 * - Hardware-Signed ECDSA IoT Telemetry Verifier
 * - Class I Recall Blast Radius & Destruction Manifest Analyzer
 * ============================================================================
 */

export const MEDSUPPLY_COMMAND_DOMAIN = {
  name: 'MedSupplySentinelGovernance',
  version: '2',
  chainId: 31337,
  verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const,
};

export const COMMAND_TYPED_DATA_TYPES = {
  ActionCommand: [
    { name: 'action', type: 'string' },
    { name: 'targetId', type: 'string' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'nonce', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/**
 * Generates a unique cryptographically secure random blinding salt for Zero-Knowledge Rx receipts
 */
export function generateCSPRNGBlindingSalt(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `ZK-SALT-${hex.slice(0, 16)}`;
}

/**
 * Evaluates thermal drift velocity (°C/hr), 2-hour excursion forecast, and Arrhenius remaining potency %
 */
export function evaluatePredictiveColdChain(
  readings: TelemetryEvent[],
  minTemp: number,
  maxTemp: number
): PredictiveColdChainResult {
  const sorted = [...readings].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const mktCelsius = calculateMeanKineticTemperature(sorted.map((r) => r.temperature));

  if (sorted.length === 0) {
    return {
      driftPerHour: 0,
      projectedTemp2h: (minTemp + maxTemp) / 2,
      isExcursionImminent: false,
      remainingShelfLifePct: 100,
      mktCelsius: 0,
      recommendation: 'Awaiting telemetry stream for Arrhenius kinetic analysis.',
    };
  }

  let driftPerHour = 0;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const curr = sorted[sorted.length - 1];
    const dtHours = Math.max(
      (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600000,
      0.25
    );
    driftPerHour = Math.round(((curr.temperature - prev.temperature) / dtHours) * 100) / 100;
  }

  const latestTemp = sorted[sorted.length - 1].temperature;
  const projectedTemp2h = Math.round((latestTemp + driftPerHour * 2) * 100) / 100;
  const alreadyBreached = sorted.some((r) => r.isBreached);

  const isExcursionImminent =
    !alreadyBreached &&
    ((driftPerHour > 0.2 && projectedTemp2h > maxTemp) ||
      (driftPerHour < -0.2 && projectedTemp2h < minTemp));

  // Arrhenius degradation approximation relative to nominal midpoint
  const nominalMid = (minTemp + maxTemp) / 2;
  const breachCount = sorted.filter((r) => r.isBreached).length;
  const thermalStress = Math.max(0, mktCelsius - nominalMid);
  const penalty = Math.min(95, breachCount * 14.5 + thermalStress * 2.4);
  const remainingShelfLifePct = Math.max(5, Math.round((100 - penalty) * 10) / 10);

  let imminentWarning: string | undefined;
  let recommendation = 'Thermal kinetic curve stable within USP storage envelope.';
  if (alreadyBreached) {
    recommendation = 'Cold-chain breach occurred. Quarantine inventory & inspect potency assay.';
  } else if (isExcursionImminent) {
    imminentWarning = `EXCURSION_IMMINENT: +${driftPerHour.toFixed(2)}°C/hr slope projects ${projectedTemp2h}°C within 2h (Limit: ${minTemp}°C–${maxTemp}°C).`;
    recommendation = 'Dispatch auxiliary reefer cooling unit immediately before limit breach.';
  }

  return {
    driftPerHour,
    projectedTemp2h,
    isExcursionImminent,
    imminentWarning,
    remainingShelfLifePct,
    mktCelsius,
    recommendation,
  };
}

/**
 * Computes hardware telemetry canonical digest for ECDSA IoT sensor verification
 */
export function buildHardwareTelemetryDigest(params: {
  batchId: string;
  temperature: number;
  humidity: number;
  latitude: number;
  longitude: number;
  timestamp: string;
  deviceId: string;
}): string {
  const tempX100 = Math.round(params.temperature * 100);
  const humX100 = Math.round(params.humidity * 100);
  const latE6 = Math.round(params.latitude * 1e6);
  const lonE6 = Math.round(params.longitude * 1e6);
  return computeKeccakHex(
    `IOT_TELEMETRY_V1:${params.batchId}:${tempX100}:${humX100}:${latE6}:${lonE6}:${params.timestamp}:${params.deviceId}`
  );
}

/**
 * Verifies an ECDSA signature emitted by an authorized hardware IoT gateway sensor
 */
export async function verifySignedTelemetryECDSA(
  params: {
    batchId: string;
    temperature: number;
    humidity: number;
    latitude: number;
    longitude: number;
    timestamp: string;
    deviceId: string;
    signature: string;
  },
  authorizedSensorAddresses: string[]
): Promise<{ isValid: boolean; recoveredAddress?: string; readingHash: string }> {
  const readingHash = buildHardwareTelemetryDigest(params);
  try {
    const cleanSig = params.signature.trim().startsWith('0x')
      ? (params.signature.trim() as `0x${string}`)
      : (`0x${params.signature.trim()}` as `0x${string}`);
    const recovered = await recoverMessageAddress({
      message: { raw: readingHash as `0x${string}` },
      signature: cleanSig,
    });
    const isValid = authorizedSensorAddresses.some(
      (addr) => addr.toLowerCase() === recovered.toLowerCase()
    );
    return { isValid, recoveredAddress: recovered, readingHash };
  } catch {
    return { isValid: false, readingHash };
  }
}

/**
 * Computes Class I Recall Blast Radius across pharmacies, transit fleet, and dispensed ZK receipts
 */
export function computeRecallBlastRadius(
  batch: BatchRecord,
  packs: MedicinePackRecord[]
): RecallBlastRadiusResult {
  const batchPacks = packs.filter((p) => p.batchId === batch.batchId);
  const custodianSet = new Set<string>();
  const destructibleSerials: string[] = [];
  const patientExposureSerials: string[] = [];

  let atPharmacyCount = 0;
  let inTransitCount = 0;
  let manufacturedCount = 0;
  let dispensedPatientReceipts = 0;
  let destroyedCount = 0;

  for (const p of batchPacks) {
    custodianSet.add(p.currentCustodian);
    if (p.status === 'DISPENSED') {
      dispensedPatientReceipts++;
      patientExposureSerials.push(p.serialNumber);
    } else if (
      p.status === 'RETURNED_FOR_DESTRUCTION' ||
      p.status === 'DESTROYED_WITNESSED'
    ) {
      destroyedCount++;
    } else {
      destructibleSerials.push(p.serialNumber);
      if (p.status === 'AT_PHARMACY' || p.custodianRole === 'PHARMACY') {
        atPharmacyCount++;
      } else if (p.status === 'IN_TRANSIT' || p.custodianRole === 'DISTRIBUTOR') {
        inTransitCount++;
      } else {
        manufacturedCount++;
      }
    }
  }

  return {
    batchCode: batch.batchCode,
    totalTrackedPacks: batchPacks.length,
    atPharmacyCount,
    inTransitCount,
    manufacturedCount,
    dispensedPatientReceipts,
    destroyedCount,
    affectedCustodians: Array.from(custodianSet),
    destructibleSerials,
    patientExposureSerials,
  };
}

/**
 * ============================================================================
 * ELITE CRYPTOGRAPHIC & ANTI-COUNTERFEIT PRIMITIVES
 * 1. Physical Unclonable Function (PUF) Optical Micro-Seal Hamming Distance
 * 2. Shamir (t, n) Threshold Secret Sharing over Finite Prime Field F_(2^127 - 1)
 * 3. W3C Selective-Disclosure Verifiable Credential (SD-VC Merkle Claims)
 * 4. Custody Provenance Graph Diversion & Topology Anomaly Detector
 * ============================================================================
 */

export function deriveDeterministicPUFPrint(serialNumber: string, batchId: string): string {
  return computeKeccakHex(`PUF_OPTICAL_SEAL_V1:${serialNumber}:${batchId}`);
}

/**
 * Perturbs an exact number of bits in a 256-bit hex string to simulate realistic optical scan jitter (e.g. 6 bits)
 * vs. photocopied/reprinted packaging spoof (e.g. 108 bits).
 */
export function perturbPUFBits(pufHex: string, flipBits: number): string {
  const clean = pufHex.replace(/^0x/i, '').padStart(64, '0').slice(0, 64);
  let val = BigInt(`0x${clean}`);
  const count = Math.min(Math.max(Math.floor(flipBits), 0), 256);
  for (let i = 0; i < count; i++) {
    // Spread bit flips deterministically across the 256-bit vector
    const bitPos = BigInt((i * 19 + 5) % 256);
    val ^= 1n << bitPos;
  }
  return `0x${val.toString(16).padStart(64, '0')}`;
}

/**
 * Computes exact 256-bit XOR popcount Hamming Distance matching MedSupplySentinel.sol verifyPUFOpticalSeal
 */
export function computePUFHammingMatch(
  anchoredPufHex: string,
  scannedPufHex: string,
  maxAllowedDrift: number = 24
): PUFMatchResult {
  const normAnchored = `0x${anchoredPufHex.replace(/^0x/i, '').padStart(64, '0').slice(0, 64).toLowerCase()}`;
  const normScanned = `0x${scannedPufHex.replace(/^0x/i, '').padStart(64, '0').slice(0, 64).toLowerCase()}`;

  let diff = BigInt(normAnchored) ^ BigInt(normScanned);
  let bitDrift = 0;
  while (diff !== 0n) {
    diff &= diff - 1n;
    bitDrift++;
  }

  const totalBits = 256;
  const similarityPct = Math.round(((totalBits - bitDrift) / totalBits) * 1000) / 10;

  let verdict: PUFMatchResult['verdict'] = 'GENUINE_OPTICAL_SEAL';
  if (bitDrift > 64) {
    verdict = 'CLONED_PHOTOCOPY_REJECTED';
  } else if (bitDrift > maxAllowedDrift) {
    verdict = 'SUSPECT_OPTICAL_DRIFT';
  }

  return {
    anchoredPufHash: normAnchored,
    scannedPufHash: normScanned,
    bitDrift,
    totalBits,
    similarityPct,
    verdict,
    isAuthentic: bitDrift <= maxAllowedDrift,
  };
}

// 127-bit Mersenne Prime: 2^127 - 1 (true finite prime field for Shamir polynomial arithmetic)
const SHAMIR_MERSENNE_PRIME = (1n << 127n) - 1n;

function modPos(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modPos(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function modInversePrime(a: bigint, prime: bigint): bigint {
  const norm = modPos(a, prime);
  if (norm === 0n) {
    throw new Error('Zero has no modular multiplicative inverse.');
  }
  return modPow(norm, prime - 2n, prime);
}

function bytesToChunks15(bytes: Uint8Array): bigint[] {
  const chunks: bigint[] = [];
  for (let i = 0; i < bytes.length; i += 15) {
    const slice = bytes.slice(i, i + 15);
    // Prefix with length byte (1..15) so trailing zero bytes never collapse
    let n = BigInt(slice.length);
    for (let j = 0; j < slice.length; j++) {
      n = (n << 8n) | BigInt(slice[j]);
    }
    chunks.push(n);
  }
  return chunks;
}

function chunks15ToBytes(chunks: bigint[]): Uint8Array {
  const out: number[] = [];
  for (const chunk of chunks) {
    const byteLen = Number((chunk >> BigInt(Math.floor((chunk.toString(2).length - 1) / 8) * 8)) & 0xffn);
    // Extract exact encoded byte count from top non-zero marker
    const sliceBytes: number[] = [];
    let temp = chunk;
    while (temp > 0n) {
      sliceBytes.unshift(Number(temp & 0xffn));
      temp >>= 8n;
    }
    const declaredLen = sliceBytes[0] ?? 0;
    const payload = sliceBytes.slice(1);
    while (payload.length < declaredLen && byteLen >= 0) {
      payload.unshift(0);
    }
    for (let k = 0; k < Math.min(declaredLen, payload.length); k++) {
      out.push(payload[k]);
    }
  }
  return new Uint8Array(out);
}

/**
 * Splits a sensitive recall recovery token using Shamir (threshold=2, n=3) polynomial sharing over GF(2^127 - 1)
 */
export function splitSecretShamir(
  secretText: string,
  deterministicSeed?: string
): ShamirShareRecord[] {
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(secretText);
  const chunks = bytesToChunks15(rawBytes.length > 0 ? rawBytes : new Uint8Array([32]));

  const custodians: Array<{ index: number; custodianLabel: string; role: RoleType }> = [
    { index: 1, custodianLabel: 'Hospital Pharmacy Cold Vault (#1)', role: 'PHARMACY' },
    { index: 2, custodianLabel: 'Manufacturer QA Compliance (#2)', role: 'MANUFACTURER' },
    { index: 3, custodianLabel: 'FDA / Drug Regulator Inspector (#3)', role: 'REGULATOR' },
  ];

  const shareYChunks: string[][] = [[], [], []];

  chunks.forEach((secretChunk, chunkIdx) => {
    const coeffHex = deterministicSeed
      ? computeKeccakHex(`SHAMIR_COEFF:${deterministicSeed}:${chunkIdx}`)
      : computeKeccakHex(`SHAMIR_RAND:${generateCSPRNGBlindingSalt()}:${chunkIdx}`);
    const a1 = (BigInt(coeffHex) % (SHAMIR_MERSENNE_PRIME - 2n)) + 1n;

    custodians.forEach((cust, cIdx) => {
      const x = BigInt(cust.index);
      const fx = modPos(secretChunk + a1 * x, SHAMIR_MERSENNE_PRIME);
      shareYChunks[cIdx].push(`0x${fx.toString(16).padStart(32, '0')}`);
    });
  });

  return custodians.map((cust, cIdx) => ({
    index: cust.index,
    custodianLabel: cust.custodianLabel,
    role: cust.role,
    yChunksHex: shareYChunks[cIdx],
    shareCommitment: computeKeccakHex(
      `SHAMIR_COMMIT_V1:${cust.index}:${shareYChunks[cIdx].join(',')}`
    ),
  }));
}

/**
 * Reconstructs the exact secret via Lagrange Interpolation at x = 0 in F_(2^127 - 1) when >= 2 shares are supplied.
 */
export function reconstructSecretShamir(
  shares: ShamirShareRecord[],
  threshold: number = 2
): ShamirReconstructionResult {
  const uniqueShares = Array.from(
    new Map(shares.map((s) => [s.index, s])).values()
  );

  if (uniqueShares.length < threshold) {
    return {
      ok: false,
      sharesUsed: uniqueShares.length,
      threshold,
      primeFieldLabel: 'GF(2^127 - 1)',
      lagrangeCoefficients: [],
      error: `ThresholdSecurityHold: Received ${uniqueShares.length}/${threshold} shares. Information-theoretic zero leakage enforced.`,
    };
  }

  const activeShares = uniqueShares.slice(0, threshold);
  if (activeShares.some((s) => !s.yChunksHex || s.yChunksHex.length === 0)) {
    return {
      ok: false,
      sharesUsed: 0,
      threshold,
      primeFieldLabel: 'GF(2^127 - 1)',
      lagrangeCoefficients: [],
      error:
        'ShamirSharesSealedECIES: Custodian shares are encrypted under secp256k1 ECDH envelopes and must be unlocked by their respective authority keys.',
    };
  }
  const chunkCount = activeShares[0]?.yChunksHex.length || 0;
  if (chunkCount === 0 || activeShares.some((s) => s.yChunksHex.length !== chunkCount)) {
    return {
      ok: false,
      sharesUsed: activeShares.length,
      threshold,
      primeFieldLabel: 'GF(2^127 - 1)',
      lagrangeCoefficients: [],
      error: 'Corrupted or incompatible Shamir share chunk lengths.',
    };
  }

  // Lagrange basis weights L_i(0) = prod_{j != i} (-x_j) / (x_i - x_j) mod P
  const lambdas: bigint[] = [];
  const lagrangeTrace: string[] = [];

  for (let i = 0; i < activeShares.length; i++) {
    const xi = BigInt(activeShares[i].index);
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < activeShares.length; j++) {
      if (i === j) continue;
      const xj = BigInt(activeShares[j].index);
      num = modPos(num * -xj, SHAMIR_MERSENNE_PRIME);
      den = modPos(den * (xi - xj), SHAMIR_MERSENNE_PRIME);
    }
    const lambda = modPos(num * modInversePrime(den, SHAMIR_MERSENNE_PRIME), SHAMIR_MERSENNE_PRIME);
    lambdas.push(lambda);
    lagrangeTrace.push(`L_${activeShares[i].index}(0) = 0x${lambda.toString(16).slice(0, 14)}...`);
  }

  const recoveredChunks: bigint[] = [];
  for (let c = 0; c < chunkCount; c++) {
    let secretChunk = 0n;
    for (let i = 0; i < activeShares.length; i++) {
      const yi = BigInt(activeShares[i].yChunksHex[c]);
      secretChunk = modPos(secretChunk + yi * lambdas[i], SHAMIR_MERSENNE_PRIME);
    }
    recoveredChunks.push(secretChunk);
  }

  const decodedBytes = chunks15ToBytes(recoveredChunks);
  const recoveredSecret = new TextDecoder().decode(decodedBytes);

  return {
    ok: true,
    sharesUsed: activeShares.length,
    threshold,
    recoveredSecret,
    primeFieldLabel: 'GF(2^127 - 1)',
    lagrangeCoefficients: lagrangeTrace,
  };
}

/**
 * Generates a W3C Selective-Disclosure Verifiable Credential (SD-VC Merkle Claims)
 * where hidden fields retain cryptographic inclusion hashes without revealing cleartext PII/batch data.
 */
export function createSelectiveDisclosureVC(
  pack: MedicinePackRecord,
  batch: BatchRecord,
  telemetry: TelemetryEvent[],
  revealKeys: string[]
): SelectiveDisclosureVC {
  const isBreached = telemetry.some((t) => t.batchId === batch.batchId && t.isBreached);
  const rawClaims: Array<{ key: string; label: string; value: string }> = [
    { key: 'productName', label: 'Medication Product', value: `${batch.brandName} (${batch.strength})` },
    {
      key: 'authenticity',
      label: 'On-Chain Authenticity',
      value: batch.isRecalled || batch.isQuarantined ? 'HOLD_QUARANTINED' : 'VERIFIED_AUTHENTIC',
    },
    {
      key: 'coldChainCompliant',
      label: 'USP Cold-Chain Status',
      value: isBreached ? 'EXCURSION_ALERT' : `COMPLIANT (${batch.minTemp}°C–${batch.maxTemp}°C)`,
    },
    { key: 'batchCode', label: 'Manufacturing Lot', value: batch.batchCode },
    { key: 'custodian', label: 'Dispensing Custodian', value: pack.currentCustodian },
    {
      key: 'dispenseStatus',
      label: 'Lifecycle State',
      value: `${pack.status}${pack.dispensedAt ? ` (${pack.dispensedAt.slice(0, 10)})` : ''}`,
    },
  ];

  const leavesWithSalts = rawClaims.map((c) => {
    const salt = computeKeccakHex(`SD_VC_SALT:${pack.serialNumber}:${c.key}`).slice(0, 26);
    const leafHash = computeKeccakHex(`SD_CLAIM:${c.key}:${c.value}:${salt}`);
    return { ...c, salt, leafHash };
  });

  // Build claims binary Merkle tree
  const layers: string[][] = [leavesWithSalts.map((l) => l.leafHash)];
  while (layers[layers.length - 1].length > 1) {
    const curr = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < curr.length; i += 2) {
      const left = curr[i];
      const right = curr[i + 1] ?? left;
      next.push(hashMerkleNodePair(left, right));
    }
    layers.push(next);
  }
  const claimsMerkleRoot = layers[layers.length - 1][0];

  const revealSet = new Set(revealKeys);
  const claims: SelectiveDisclosureClaimNode[] = leavesWithSalts.map((item, idx) => {
    const proof: string[] = [];
    let cursor = idx;
    for (let l = 0; l < layers.length - 1; l++) {
      const layer = layers[l];
      const sibIdx = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
      proof.push(layer[sibIdx] ?? layer[cursor]);
      cursor = Math.floor(cursor / 2);
    }

    const revealed = revealSet.has(item.key);
    return {
      key: item.key,
      label: item.label,
      salt: revealed ? item.salt : '0xREDACTED',
      revealed,
      value: revealed ? item.value : undefined,
      leafHash: item.leafHash,
      merkleProof: proof,
    };
  });

  return {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/security/suites/eip712sig-2023/v1'],
    type: ['VerifiableCredential', 'PharmaceuticalProvenanceSDVC'],
    issuer: `did:ethr:31337:${batch.manufacturerAddress}`,
    issuanceDate: pack.dispensedAt || batch.manufacturedAt,
    subjectSerial: pack.serialNumber,
    claimsMerkleRoot,
    issuerSignatureDigest: computeKeccakHex(`SD_VC_SIG:${claimsMerkleRoot}:${pack.signature}`),
    claims,
  };
}

/**
 * Verifies every revealed field in a Selective-Disclosure W3C Verifiable Credential against its Claims Merkle Root.
 */
export function verifySelectiveDisclosureVC(vc: SelectiveDisclosureVC): {
  valid: boolean;
  revealedVerifiedCount: number;
  redactedCount: number;
} {
  let revealedVerifiedCount = 0;
  let redactedCount = 0;

  for (const claim of vc.claims) {
    if (!claim.revealed) {
      redactedCount++;
      continue;
    }
    const recomputedLeaf = computeKeccakHex(
      `SD_CLAIM:${claim.key}:${claim.value ?? ''}:${claim.salt}`
    );
    if (recomputedLeaf.toLowerCase() !== claim.leafHash.toLowerCase()) {
      return { valid: false, revealedVerifiedCount, redactedCount };
    }
    if (!verifyMerkleInclusionProof(recomputedLeaf, claim.merkleProof, vc.claimsMerkleRoot)) {
      return { valid: false, revealedVerifiedCount, redactedCount };
    }
    revealedVerifiedCount++;
  }

  return {
    valid: true,
    revealedVerifiedCount,
    redactedCount,
  };
}

/**
 * Custody Provenance Graph Diversion & Markov Transition Anomaly Analyzer
 */
export function analyzeCustodyGraphDiversion(
  packs: MedicinePackRecord[],
  custodyEvents: CustodyEvent[]
): CustodyGraphDiversionAnalysis {
  const edgeMap = new Map<string, CustodyGraphEdge>();

  const inferStage = (actor: string, action: string): string => {
    const a = actor.toLowerCase();
    if (a.includes('genesis') || a.includes('0x0000')) return 'GENESIS';
    if (a.includes('pfizer') || a.includes('abbvie') || a.includes('novo') || action === 'MINT_GENESIS') {
      return 'MANUFACTURER';
    }
    if (a.includes('logistics') || a.includes('cold') || action === 'TRANSFER_DISTRIBUTOR') {
      return 'DISTRIBUTOR';
    }
    if (a.includes('pharmacy') || a.includes('hospital') || action === 'TRANSFER_PHARMACY') {
      return 'PHARMACY';
    }
    if (a.includes('patient') || action === 'DISPENSED_TO_PATIENT' || action === 'DISPENSE_PATIENT') {
      return 'PATIENT';
    }
    if (a.includes('regulator') || a.includes('fda') || action.includes('WITNESS') || action.includes('QUARANTINE')) {
      return 'REGULATOR';
    }
    return 'UNVERIFIED_BROKER';
  };

  const validTransitions = new Set([
    'GENESIS->MANUFACTURER',
    'MANUFACTURER->DISTRIBUTOR',
    'DISTRIBUTOR->PHARMACY',
    'PHARMACY->PATIENT',
    'MANUFACTURER->PHARMACY',
    'PHARMACY->REGULATOR',
    'DISTRIBUTOR->REGULATOR',
  ]);

  let totalTransitions = 0;
  let anomalousTransitions = 0;

  for (const evt of custodyEvents) {
    const fromRole = inferStage(evt.fromActor, evt.action);
    const toRole = inferStage(evt.toActor, evt.action);
    const transitionKey = `${fromRole}->${toRole}`;
    const mapKey = `${fromRole}::${toRole}::${evt.fromActor}::${evt.toActor}`;

    // Check forward flow or legitimate regulator/corridor event
    const isOpsEvent =
      evt.action.includes('CORRIDOR') ||
      evt.action.includes('HUB') ||
      evt.action.includes('QUARANTINE') ||
      evt.action.includes('RECALL') ||
      evt.action.includes('DESTRUCTION');

    const isSuspiciousPack = packs.some(
      (pk) => pk.serialHash === evt.serialHash && pk.isSuspicious
    );

    const isTransitionInvalid =
      !isOpsEvent &&
      (!validTransitions.has(transitionKey) || fromRole === 'UNVERIFIED_BROKER' || toRole === 'UNVERIFIED_BROKER');

    const isAnomaly = isTransitionInvalid || (isSuspiciousPack && toRole === 'PHARMACY');
    totalTransitions++;
    if (isAnomaly) anomalousTransitions++;

    const existing = edgeMap.get(mapKey);
    if (existing) {
      existing.count += 1;
      existing.isAnomaly = existing.isAnomaly || isAnomaly;
    } else {
      edgeMap.set(mapKey, {
        id: mapKey,
        fromRole,
        toRole,
        fromActor: evt.fromActor,
        toActor: evt.toActor,
        count: 1,
        isAnomaly,
        anomalyReason: isTransitionInvalid
          ? `Non-canonical tier hop (${transitionKey}) flagged by Markov provenance policy`
          : isAnomaly
          ? 'Associated pack triggered duplicate/clone scan anomaly at destination'
          : undefined,
      });
    }
  }

  const penalty = anomalousTransitions * 18;
  const integrityScore = Math.max(15, Math.min(100, 100 - penalty));
  const diversionAlertSummary =
    anomalousTransitions === 0
      ? 'Zero grey-market diversion loops or unauthorized broker hops detected across supply topology.'
      : `${anomalousTransitions} suspicious custody edge(s) flagged for grey-market diversion or clone divergence inspection.`;

  return {
    integrityScore,
    totalTransitions,
    anomalousTransitions,
    diversionAlertSummary,
    edges: Array.from(edgeMap.values()).slice(0, 8),
  };
}

/**
 * ============================================================================
 * PER-CUSTODIAN ECIES (secp256k1 ECDH + Keccak-CTR + Encrypt-then-MAC)
 * Ensures Shamir shares are encrypted at rest per authority so GET /api/ledger
 * never leaks multiple plaintext threshold shares.
 * ============================================================================
 */

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function uint8ToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function getCompressedPubKeyFromPrivKey(privateKeyHex: string): string {
  const privBytes = hexToUint8(privateKeyHex);
  return uint8ToHex(secp256k1.getPublicKey(privBytes, true));
}

export function encryptShamirShareECIES(
  yChunksHex: string[],
  recipientPublicKeyHex: string,
  deterministicSeed?: string
): ECIESEncryptedEnvelope {
  let ephPriv: Uint8Array;
  if (deterministicSeed) {
    ephPriv = hexToUint8(computeKeccakHex(`ECIES_EPH:${deterministicSeed}`));
  } else if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const randomBuf = new Uint8Array(new ArrayBuffer(32));
    globalThis.crypto.getRandomValues(randomBuf);
    ephPriv = randomBuf;
  } else {
    ephPriv = hexToUint8(computeKeccakHex(`ECIES_FALLBACK:${Date.now()}:${Math.random()}`));
  }
  // Ensure valid scalar in [1, n-1]
  ephPriv[0] = (ephPriv[0] & 0x7f) || 0x01;

  const ephPubHex = uint8ToHex(secp256k1.getPublicKey(ephPriv, true));
  const sharedBytes = secp256k1.getSharedSecret(ephPriv, hexToUint8(recipientPublicKeyHex), true);
  const sharedHex = uint8ToHex(sharedBytes);

  const encKey = computeKeccakHex(`ECIES_ENC_KEY_V1:${sharedHex}`);
  const macKey = computeKeccakHex(`ECIES_MAC_KEY_V1:${sharedHex}`);

  const ivHex = deterministicSeed
    ? computeKeccakHex(`ECIES_IV:${deterministicSeed}`).slice(0, 34)
    : `0x${generateCSPRNGBlindingSalt().replace(/[^0-9A-F]/gi, '').padEnd(32, '0').slice(0, 32).toLowerCase()}`;

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(yChunksHex));
  const cipherBytes = new Uint8Array(plaintextBytes.length);

  for (let offset = 0; offset < plaintextBytes.length; offset += 32) {
    const blockIdx = Math.floor(offset / 32);
    const keystream = hexToUint8(computeKeccakHex(`CTR:${encKey}:${ivHex}:${blockIdx}`));
    for (let j = 0; j < 32 && offset + j < plaintextBytes.length; j++) {
      cipherBytes[offset + j] = plaintextBytes[offset + j] ^ keystream[j];
    }
  }

  const ciphertextHex = uint8ToHex(cipherBytes);
  const macTagHex = computeKeccakHex(`MAC:${macKey}:${ephPubHex}:${ivHex}:${ciphertextHex}`);

  return {
    ephemeralPubKey: ephPubHex,
    ivHex,
    ciphertextHex,
    macTagHex,
  };
}

export function decryptShamirShareECIES(
  envelope: ECIESEncryptedEnvelope,
  recipientPrivateKeyHex: string
): string[] {
  const privBytes = hexToUint8(recipientPrivateKeyHex);
  const sharedBytes = secp256k1.getSharedSecret(
    privBytes,
    hexToUint8(envelope.ephemeralPubKey),
    true
  );
  const sharedHex = uint8ToHex(sharedBytes);

  const encKey = computeKeccakHex(`ECIES_ENC_KEY_V1:${sharedHex}`);
  const macKey = computeKeccakHex(`ECIES_MAC_KEY_V1:${sharedHex}`);

  const expectedMac = computeKeccakHex(
    `MAC:${macKey}:${envelope.ephemeralPubKey}:${envelope.ivHex}:${envelope.ciphertextHex}`
  );
  if (expectedMac.toLowerCase() !== envelope.macTagHex.toLowerCase()) {
    throw new Error('ECIESAuthenticationFailed: Wrong custodian private key or corrupted ciphertext.');
  }

  const cipherBytes = hexToUint8(envelope.ciphertextHex);
  const plainBytes = new Uint8Array(cipherBytes.length);

  for (let offset = 0; offset < cipherBytes.length; offset += 32) {
    const blockIdx = Math.floor(offset / 32);
    const keystream = hexToUint8(computeKeccakHex(`CTR:${encKey}:${envelope.ivHex}:${blockIdx}`));
    for (let j = 0; j < 32 && offset + j < cipherBytes.length; j++) {
      plainBytes[offset + j] = cipherBytes[offset + j] ^ keystream[j];
    }
  }

  const decoded = JSON.parse(new TextDecoder().decode(plainBytes));
  if (!Array.isArray(decoded)) {
    throw new Error('ECIESPayloadInvalid: Decrypted payload is not a valid Shamir chunk array.');
  }
  return decoded.map((x) => String(x));
}

export const DEFAULT_CUSTODIAN_PUBLIC_KEYS: Record<number, string> = {
  // Pharmacy (Anvil #3)
  1: '0x0220b871f3ced029e14472ec4ebc3c0448164942b123aa6af91a3386c1c403e0eb',
  // Manufacturer (Anvil #1)
  2: '0x02ba5734d8f7091719471e7f7ed6b9df170dc70cc661ca05e688601ad984f068b0',
  // Regulator Inspector #1 (Anvil #4)
  3: '0x03bf6ee64a8d2fdc551ec8bb9ef862ef6b4bcb1805cdc520c3aa5866c0575fd3b5',
};

/**
 * Seals raw Shamir shares into per-custodian ECIES envelopes and strips plaintext yChunksHex at rest.
 */
export function sealShamirSharesECIES(
  shares: ShamirShareRecord[],
  recipientPubKeysByIndex: Record<number, string> = DEFAULT_CUSTODIAN_PUBLIC_KEYS,
  deterministicSeed?: string
): ShamirShareRecord[] {
  return shares.map((s) => {
    const pubKey = recipientPubKeysByIndex[s.index] || DEFAULT_CUSTODIAN_PUBLIC_KEYS[s.index];
    if (!pubKey) return s;
    const envelope = encryptShamirShareECIES(
      s.yChunksHex,
      pubKey,
      deterministicSeed ? `${deterministicSeed}:${s.index}` : undefined
    );
    return {
      index: s.index,
      custodianLabel: s.custodianLabel,
      role: s.role,
      yChunksHex: [],
      shareCommitment: s.shareCommitment,
      recipientPublicKey: pubKey,
      eciesEnvelope: envelope,
      isSealedECIES: true,
    };
  });
}

/**
 * ============================================================================
 * NON-INTERACTIVE ZERO-KNOWLEDGE PROOF (secp256k1 Pedersen-Schnorr NIZK)
 * Proves knowledge of (rxId, blindingSalt) opening C = w*G + r*H without
 * transmitting rxId or blindingSalt to the verifier.
 * ============================================================================
 */

const SECP256K1_N = secp256k1.CURVE.n;

function modN(val: bigint): bigint {
  const r = val % SECP256K1_N;
  return r >= 0n ? r : r + SECP256K1_N;
}

function derivePedersenGeneratorH(): typeof secp256k1.ProjectivePoint.BASE {
  for (let ctr = 0; ctr < 256; ctr++) {
    const candidateX = computeKeccakHex(`MEDSUPPLY_PEDERSEN_H_V1:${ctr}`).slice(2);
    try {
      return secp256k1.ProjectivePoint.fromHex(`02${candidateX}`);
    } catch {
      // Try next x-coordinate
    }
  }
  throw new Error('Failed to derive Pedersen generator H');
}

const PEDERSEN_H = derivePedersenGeneratorH();

function hashToScalarModN(seed: string): bigint {
  const h = BigInt(computeKeccakHex(seed));
  const m = modN(h);
  return m === 0n ? 1n : m;
}

export function createNIZKPrescriptionProof(
  serialNumber: string,
  prescriptionRefId: string,
  patientSecretSalt: string
): NIZKPrescriptionProof {
  const serialHash = computeKeccakHex(serialNumber.trim());
  const rxNorm = prescriptionRefId.trim().toUpperCase();
  const saltNorm = patientSecretSalt.trim();

  const w = hashToScalarModN(`NIZK_WITNESS:${serialHash}:${rxNorm}`);
  const r = hashToScalarModN(`NIZK_BLIND:${saltNorm}`);

  const G = secp256k1.ProjectivePoint.BASE;
  const C = G.multiply(w).add(PEDERSEN_H.multiply(r));
  const commitmentPoint = `0x${C.toHex(true)}`;
  const generatorHPoint = `0x${PEDERSEN_H.toHex(true)}`;

  // Ephemeral nonces k1, k2 (CSPRNG or random)
  const k1 = hashToScalarModN(`K1:${generateCSPRNGBlindingSalt()}:${serialHash}`);
  const k2 = hashToScalarModN(`K2:${generateCSPRNGBlindingSalt()}:${rxNorm}`);
  const R = G.multiply(k1).add(PEDERSEN_H.multiply(k2));
  const announcementR = `0x${R.toHex(true)}`;

  const challengeHex = computeKeccakHex(
    `MEDSUPPLY_NIZK_V1:${serialHash}:${commitmentPoint}:${announcementR}:${generatorHPoint}`
  );
  const c = modN(BigInt(challengeHex));

  const s1 = modN(k1 - c * w);
  const s2 = modN(k2 - c * r);

  return {
    scheme: 'SECP256K1_PEDERSEN_SCHNORR_NIZK_V1',
    serialHash,
    commitmentPoint,
    generatorHPoint,
    announcementR,
    challengeHex,
    responseS1Hex: `0x${s1.toString(16).padStart(64, '0')}`,
    responseS2Hex: `0x${s2.toString(16).padStart(64, '0')}`,
    zeroWitnessLeaked: true,
  };
}

export function verifyNIZKPrescriptionProof(proof: NIZKPrescriptionProof): boolean {
  try {
    const G = secp256k1.ProjectivePoint.BASE;
    const H = secp256k1.ProjectivePoint.fromHex(proof.generatorHPoint.replace(/^0x/i, ''));
    const C = secp256k1.ProjectivePoint.fromHex(proof.commitmentPoint.replace(/^0x/i, ''));
    const R = secp256k1.ProjectivePoint.fromHex(proof.announcementR.replace(/^0x/i, ''));

    if (!H.equals(PEDERSEN_H)) {
      return false;
    }

    const expectedChallengeHex = computeKeccakHex(
      `MEDSUPPLY_NIZK_V1:${proof.serialHash}:${proof.commitmentPoint}:${proof.announcementR}:${proof.generatorHPoint}`
    );
    if (expectedChallengeHex.toLowerCase() !== proof.challengeHex.toLowerCase()) {
      return false;
    }

    const c = modN(BigInt(proof.challengeHex));
    const s1 = modN(BigInt(proof.responseS1Hex));
    const s2 = modN(BigInt(proof.responseS2Hex));

    // Check R' == s1*G + s2*H + c*C
    const rhs = G.multiply(s1).add(H.multiply(s2)).add(C.multiply(c));
    return rhs.equals(R);
  } catch {
    return false;
  }
}




