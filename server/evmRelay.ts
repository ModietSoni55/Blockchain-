import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

const DEFAULT_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const DEFAULT_RELAYER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

function getContractAddress(): `0x${string}` {
  return (process.env.SENTINEL_CONTRACT_ADDRESS || DEFAULT_CONTRACT_ADDRESS) as `0x${string}`;
}

function getRelayerKey(): `0x${string}` {
  return (process.env.ISSUER_PRIVATE_KEY || DEFAULT_RELAYER_KEY) as `0x${string}`;
}

const SENTINEL_RELAY_ABI = parseAbi([
  'function anchorBatchMerkleRoot(bytes32 batchId, bytes32 merkleRoot) external',
  'function anchorPackPufSeal(bytes32 serialHash, bytes32 pufSealHash) external',
  'function commitShamirBreakGlassShares(bytes32 serialHash, bytes32[3] shareCommitments) external',
  'function recordBreakGlassReconstruction(bytes32 serialHash, uint8 sharesSubmitted) external',
]);

export interface EvmRelayResult {
  evmAnchored: boolean;
  mode: 'LIVE_EVM_CONTRACT' | 'LIVE_EVM_RPC_NO_BYTECODE' | 'SQLITE_WAL_SANDBOX';
  txHash?: string;
  blockNumber?: string;
  contractAddress: string;
}

export async function probeLiveEvmNode(custodyEventCount: number): Promise<{
  connected: boolean;
  contractDeployed: boolean;
  mode: string;
  rpcUrl: string;
  chainId: number;
  blockNumber: string;
  contractAddress: string;
}> {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const contractAddress = getContractAddress();
  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 600, retryCount: 0 }),
    });
    const [chainId, blockNumber, code] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getCode({ address: contractAddress }).catch(() => undefined),
    ]);
    const contractDeployed = Boolean(code && code !== '0x');
    return {
      connected: true,
      contractDeployed,
      mode: contractDeployed ? 'LIVE_EVM_CONTRACT' : 'LIVE_EVM_RPC',
      rpcUrl,
      chainId,
      blockNumber: blockNumber.toString(),
      contractAddress,
    };
  } catch {
    return {
      connected: false,
      contractDeployed: false,
      mode: 'SQLITE_WAL_SANDBOX',
      rpcUrl,
      chainId: 31337,
      blockNumber: String(18420100 + custodyEventCount),
      contractAddress,
    };
  }
}

/**
 * Dual-writes critical cryptographic state anchors directly to MedSupplySentinel.sol
 * whenever an Anvil / EVM RPC node with deployed bytecode is reachable.
 */
export async function relayToEvmIfDeployed(
  functionName:
    | 'anchorBatchMerkleRoot'
    | 'anchorPackPufSeal'
    | 'commitShamirBreakGlassShares'
    | 'recordBreakGlassReconstruction',
  args: readonly unknown[]
): Promise<EvmRelayResult> {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const contractAddress = getContractAddress();
  try {
    const publicClient = createPublicClient({
      transport: http(rpcUrl, { timeout: 500, retryCount: 0 }),
    });
    const code = await publicClient.getCode({ address: contractAddress });
    if (!code || code === '0x') {
      return {
        evmAnchored: false,
        mode: 'LIVE_EVM_RPC_NO_BYTECODE',
        contractAddress,
      };
    }

    const account = privateKeyToAccount(getRelayerKey());
    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(rpcUrl, { timeout: 2500, retryCount: 0 }),
    });

    const txHash = await walletClient.writeContract({
      address: contractAddress,
      abi: SENTINEL_RELAY_ABI,
      functionName,
      args: args as never,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 4000 });

    return {
      evmAnchored: receipt.status === 'success',
      mode: 'LIVE_EVM_CONTRACT',
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      contractAddress,
    };
  } catch {
    return {
      evmAnchored: false,
      mode: 'SQLITE_WAL_SANDBOX',
      contractAddress,
    };
  }
}
