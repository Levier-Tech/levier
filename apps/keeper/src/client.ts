import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Define target chain
export const targetChain = defineChain({
  id: config.CHAIN_ID,
  name: `Chain ${config.CHAIN_ID}`,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [config.RPC_URL] },
    public: { http: [config.RPC_URL] },
  },
});

// Keeper wallet account
export const keeperAccount = privateKeyToAccount(config.KEEPER_PRIVATE_KEY as `0x${string}`);

// Viem Clients
export const publicClient = createPublicClient({
  chain: targetChain,
  transport: http(config.RPC_URL),
});

export const walletClient = createWalletClient({
  account: keeperAccount,
  chain: targetChain,
  transport: http(config.RPC_URL),
});

// Supabase Client
export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

// ABIs
export const AutoProtectABI = [
  {
    type: 'function',
    name: 'executeAutoProtect',
    inputs: [
      { name: 'pairAddress', type: 'address' },
      { name: 'borrower', type: 'address' },
      { name: 'repayAmount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isKeeper',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'userConfigs',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'pair', type: 'address' },
    ],
    outputs: [
      { name: 'isEnabled', type: 'bool' },
      { name: 'triggerLtvBps', type: 'uint256' },
      { name: 'targetLtvBps', type: 'uint256' },
      { name: 'maxDeleverage', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export const LeveraPairABI = [
  {
    type: 'function',
    name: 'getPosition',
    inputs: [{ name: 'borrower', type: 'address' }],
    outputs: [
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'debtAmount', type: 'uint256' },
      { name: 'collateralValueUsd', type: 'uint256' },
      { name: 'maxBorrowUsd', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'debtToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

export const ERC20ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;
