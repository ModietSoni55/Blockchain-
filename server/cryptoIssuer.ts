import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import {
  buildQRSignatureDigest,
  computeKeccakHex,
  MEDSUPPLY_COMMAND_DOMAIN,
  COMMAND_TYPED_DATA_TYPES,
  ParticipantEntity,
  RoleType,
} from '../src/utils/sentinelLogic.ts';

// Strictly server-side Manufacturer ECDSA signing key (never exposed to browser verification code).
// In production, load KMS / HSM / hardware signer via process.env.ISSUER_PRIVATE_KEY.
const DEFAULT_DEV_ISSUER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const RAW_ISSUER_KEY = (process.env.ISSUER_PRIVATE_KEY || DEFAULT_DEV_ISSUER_KEY) as `0x${string}`;
const issuerAccount = privateKeyToAccount(RAW_ISSUER_KEY);

// Built-in governance inspector signers matching deployed RegulatorGovernance.sol constructor
export const GOVERNANCE_ROLE_ADDRESSES: Array<{ address: string; role: RoleType; label: string }> = [
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    role: 'MANUFACTURER',
    label: 'Manufacturer Signer',
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    role: 'DISTRIBUTOR',
    label: 'Distributor Signer',
  },
  {
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    role: 'PHARMACY',
    label: 'Pharmacy Signer',
  },
  {
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    role: 'REGULATOR',
    label: 'Regulator Inspector #1',
  },
  {
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    role: 'REGULATOR',
    label: 'Regulator Co-Signer #2',
  },
];

export function getIssuerPublicAddress(): string {
  return issuerAccount.address;
}

/**
 * Signs a serialized pack QR payload using asymmetric secp256k1 ECDSA strictly on the backend.
 */
export async function signPackQRWithServerECDSA(
  serialNumber: string,
  batchId: string,
  expiresAt: string,
  nonce: string
): Promise<string> {
  const digest = buildQRSignatureDigest(serialNumber, batchId, expiresAt, nonce);
  return issuerAccount.signMessage({
    message: { raw: digest as `0x${string}` },
  });
}

export interface SignedCommandEnvelope<T = Record<string, unknown>> {
  action: string;
  targetId: string;
  payload: T;
  nonce: string;
  deadline: number;
  expectedVersion?: number;
  signerAddress: string;
  signerRole: RoleType;
  signature: `0x${string}`;
}

/**
 * Verifies an EIP-712 signed command envelope server-side using ecrecover (recoverTypedDataAddress)
 * and resolves the caller's authorized AccessControl role from the SQLite registry + governance signers.
 */
export async function verifyCommandEIP712(
  envelope: SignedCommandEnvelope,
  participants: ParticipantEntity[]
): Promise<{
  ok: boolean;
  recoveredAddress?: string;
  resolvedRole?: RoleType;
  error?: string;
}> {
  if (!envelope || !envelope.signature || !envelope.action || !envelope.nonce) {
    return { ok: false, error: 'Missing EIP-712 signature envelope fields.' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number(envelope.deadline) < nowSeconds) {
    return { ok: false, error: 'EIP-712 signed command deadline has expired.' };
  }

  const payloadHash = computeKeccakHex(JSON.stringify(envelope.payload ?? {})) as `0x${string}`;

  let recoveredAddress: string;
  try {
    recoveredAddress = await recoverTypedDataAddress({
      domain: MEDSUPPLY_COMMAND_DOMAIN,
      types: COMMAND_TYPED_DATA_TYPES,
      primaryType: 'ActionCommand',
      message: {
        action: envelope.action,
        targetId: envelope.targetId || 'GLOBAL',
        payloadHash,
        nonce: envelope.nonce,
        deadline: BigInt(envelope.deadline),
      },
      signature: envelope.signature,
    });
  } catch (err) {
    return { ok: false, error: `Invalid EIP-712 ECDSA signature: ${String(err)}` };
  }

  if (recoveredAddress.toLowerCase() !== envelope.signerAddress.toLowerCase()) {
    return {
      ok: false,
      error: `EIP-712 signer mismatch: recovered ${recoveredAddress}, claimed ${envelope.signerAddress}.`,
    };
  }

  const participantMatch = participants.find(
    (p) => p.walletAddress.toLowerCase() === recoveredAddress.toLowerCase()
  );
  if (participantMatch && !participantMatch.isAuthorized) {
    return {
      ok: false,
      error: `AccessControl: Wallet ${recoveredAddress} (${participantMatch.organizationName}) has been REVOKED.`,
    };
  }

  const govMatch = GOVERNANCE_ROLE_ADDRESSES.find(
    (g) => g.address.toLowerCase() === recoveredAddress.toLowerCase()
  );

  const resolvedRole: RoleType =
    participantMatch?.role || govMatch?.role || envelope.signerRole || 'PATIENT';

  return {
    ok: true,
    recoveredAddress,
    resolvedRole,
  };
}
