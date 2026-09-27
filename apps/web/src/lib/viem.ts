import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545';

export const publicClient = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl)
});
