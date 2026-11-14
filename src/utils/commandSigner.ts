import { privateKeyToAccount } from 'viem/accounts';
import {
  computeKeccakHex,
  MEDSUPPLY_COMMAND_DOMAIN,
  COMMAND_TYPED_DATA_TYPES,
  RoleType,
} from './sentinelLogic';

export interface SandboxSignerProfile {
  role: RoleType;
  label: string;
  address: string;
  // Standard well-known Foundry Anvil deterministic dev accounts (#1-#5) for zero-setup sandbox EIP-712 signing
  anvilDevPrivateKey: `0x${string}`;
}

export const ROLE_SIGNERS: SandboxSignerProfile[] = [
  {
    role: 'MANUFACTURER',
    label: 'Manufacturer Signer',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    anvilDevPrivateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    role: 'DISTRIBUTOR',
    label: 'Distributor Signer',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    anvilDevPrivateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  {
    role: 'PHARMACY',
    label: 'Pharmacy Signer',
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    anvilDevPrivateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  },
  {
    role: 'REGULATOR',
    label: 'Regulator Inspector #1',
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    anvilDevPrivateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  },
  {
    role: 'REGULATOR',
    label: 'Regulator Co-Signer #2',
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    anvilDevPrivateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  },
];

export interface SignedCommandRequest<T = Record<string, unknown>> {
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
 * Signs an operator governance/supply-chain command with EIP-712 Typed Structured Data
 * using either the connected MetaMask/EVM wallet or the active Foundry Anvil role signer.
 */
export async function signSentinelCommand<T extends Record<string, unknown>>(params: {
  action: string;
  targetId: string;
  payload: T;
  signer: SandboxSignerProfile;
  injectedWalletAddress?: string | null;
  expectedVersion?: number;
}): Promise<SignedCommandRequest<T>> {
  const randomBytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(randomBytes);
  const randHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const nonce = `CMD-${Date.now()}-${randHex}`;
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min validity
  const payloadHash = computeKeccakHex(JSON.stringify(params.payload ?? {})) as `0x${string}`;

  const typedMessage = {
    action: params.action,
    targetId: params.targetId || 'GLOBAL',
    payloadHash,
    nonce,
    deadline: BigInt(deadline),
  };

  let signature: `0x${string}` | undefined;
  let signerAddress = params.signer.address;

  const eth = (
    window as unknown as {
      ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<string> };
    }
  ).ethereum;

  if (params.injectedWalletAddress && eth) {
    try {
      const typedDataJson = JSON.stringify({
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          ActionCommand: COMMAND_TYPED_DATA_TYPES.ActionCommand,
        },
        primaryType: 'ActionCommand',
        domain: MEDSUPPLY_COMMAND_DOMAIN,
        message: {
          ...typedMessage,
          deadline: deadline,
        },
      });
      signature = (await eth.request({
        method: 'eth_signTypedData_v4',
        params: [params.injectedWalletAddress, typedDataJson],
      })) as `0x${string}`;
      signerAddress = params.injectedWalletAddress;
    } catch {
      // Fallback cleanly to active Anvil dev signer if wallet rejects
    }
  }

  if (!signature) {
    const account = privateKeyToAccount(params.signer.anvilDevPrivateKey);
    signature = await account.signTypedData({
      domain: MEDSUPPLY_COMMAND_DOMAIN,
      types: COMMAND_TYPED_DATA_TYPES,
      primaryType: 'ActionCommand',
      message: typedMessage,
    });
    signerAddress = account.address;
  }

  return {
    action: params.action,
    targetId: params.targetId,
    payload: params.payload,
    nonce,
    deadline,
    expectedVersion: params.expectedVersion,
    signerAddress,
    signerRole: params.signer.role,
    signature,
  };
}
