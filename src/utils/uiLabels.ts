import { VerificationOutcome } from './sentinelLogic';

export function formatPackStatusLabel(status: string): string {
  switch (status) {
    case 'MANUFACTURED':
      return 'At Manufacturer';
    case 'IN_TRANSIT':
      return 'In Transit';
    case 'AT_PHARMACY':
      return 'At Pharmacy';
    case 'DISPENSED':
      return 'Dispensed to Patient';
    case 'QUARANTINED':
      return 'Safety Hold';
    case 'RECALLED':
      return 'Recalled';
    case 'DESTROYED_WITNESSED':
      return 'Safely Destroyed';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function formatCustodyActionLabel(action: string): string {
  switch (action) {
    case 'MINT_GENESIS':
      return 'Manufactured & Digitally Sealed';
    case 'TRANSFER_DISTRIBUTOR':
      return 'Shipped to Cold-Chain Carrier';
    case 'TRANSFER_PHARMACY':
      return 'Delivered to Hospital Pharmacy';
    case 'DISPENSED_TO_PATIENT':
      return 'Dispensed to Patient';
    case 'QUARANTINE_ENFORCED':
      return 'Placed on Safety Hold';
    case 'QUARANTINE_LIFTED':
      return 'Safety Hold Lifted';
    case 'RECALL_EXECUTED':
      return 'Class I Recall Executed';
    case 'DESTRUCTION_WITNESSED':
      return 'Destruction Witnessed by Regulator';
    case 'SHAMIR_BREAK_GLASS_AUDIT':
      return 'Emergency Recall Contact Recovery Audited';
    default:
      return action
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatRiskFeatureLabel(featureKey: string): string {
  switch (featureKey) {
    case 'signature_integrity':
    case 'forged_qr_signature':
      return 'QR Digital Signature Check';
    case 'scan_frequency_anomaly':
    case 'duplicate_scan_frequency':
      return 'Duplicate Scan Activity';
    case 'geo_velocity_anomaly':
    case 'location_anomaly':
      return 'Travel Speed & Location Check';
    case 'cold_chain_excursion':
    case 'temperature_breach':
      return 'Cold Storage Temperature History';
    case 'batch_quarantine_flag':
    case 'regulatory_quarantine':
      return 'Safety Hold Status';
    case 'batch_recall':
      return 'Active Batch Recall Check';
    case 'dispensed_reuse':
      return 'Already Dispensed Check';
    case 'expiration_risk':
      return 'Expiration Date Check';
    case 'unregistered_serial':
      return 'Serial Registry Lookup';
    case 'custody_chain_completeness':
    case 'verified_custody_chain':
      return 'Verified Custody Handovers';
    case 'puf_optical_integrity':
    case 'puf_optical_clone_drift':
      return 'Physical Optical Seal (PUF)';
    default:
      return featureKey
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatSignatureMethodLabel(method: string): string {
  switch (method) {
    case 'NONE':
      return 'Serial Registry + Optical Seal Check';
    case 'LEGACY_ATTESTATION':
      return 'ECDSA Digital Seal';
    case 'EIP712_TYPED_DATA':
      return 'EIP-712 Typed Digital Signature';
    case 'ECDSA_SECP256K1':
      return 'ECDSA Secp256k1 Digital Seal';
    default:
      return method.replace(/_/g, ' ');
  }
}

export function formatActorDisplayName(actor: string): string {
  if (actor.startsWith('0x0000')) {
    return 'Manufacturing Origin';
  }
  return actor;
}

export function formatVerdictHeadline(outcome: VerificationOutcome): {
  title: string;
  badge: string;
  tone: 'safe' | 'warn' | 'danger';
} {
  switch (outcome) {
    case 'AUTHENTIC':
      return {
        title: 'Verified Authentic & Safe',
        badge: 'Genuine Medicine',
        tone: 'safe',
      };
    case 'SUSPICIOUS_DUPLICATE':
      return {
        title: 'Warning: Duplicate Scan Detected',
        badge: 'Possible Duplicate',
        tone: 'warn',
      };
    case 'COLD_CHAIN_BREACHED':
      return {
        title: 'Warning: Storage Temperature Exceeded',
        badge: 'Cold-Chain Alert',
        tone: 'warn',
      };
    case 'PHOTOCOPY_CLONE_DETECTED':
      return {
        title: 'Blocked: Suspected Photocopy Clone',
        badge: 'Physical Seal Mismatch',
        tone: 'danger',
      };
    case 'TAMPERED_SIGNATURE':
      return {
        title: 'Blocked: Invalid Digital Signature',
        badge: 'Forged QR Label',
        tone: 'danger',
      };
    case 'QUARANTINED':
      return {
        title: 'Blocked: Batch on Safety Hold',
        badge: 'Quarantined',
        tone: 'danger',
      };
    case 'EXPIRED':
      return {
        title: 'Blocked: Medicine Expired',
        badge: 'Past Expiration Date',
        tone: 'danger',
      };
    case 'ALREADY_DISPENSED':
      return {
        title: 'Warning: Already Dispensed to a Patient',
        badge: 'Previously Dispensed',
        tone: 'warn',
      };
    case 'RECALLED':
      return {
        title: 'Blocked: Active Class I Recall',
        badge: 'Do Not Use',
        tone: 'danger',
      };
    case 'UNKNOWN_SERIAL':
    default:
      return {
        title: 'Unknown Pack: Not Found in Registry',
        badge: 'Unregistered Serial',
        tone: 'danger',
      };
  }
}
