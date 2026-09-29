export const TestnetERC20ABI = [
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
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const LeverageRouterABI = [
  {
    type: 'function',
    name: 'leverageBuy',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'collateralIn', type: 'uint256' },
      { name: 'borrowAmount', type: 'uint256' },
      { name: 'minStockReceived', type: 'uint256' },
    ],
    outputs: [{ name: 'stockAcquired', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

export const ShortRouterABI = [
  {
    type: 'function',
    name: 'openShort',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'collateralIn', type: 'uint256' },
      { name: 'stockToBorrow', type: 'uint256' },
      { name: 'minStableReceived', type: 'uint256' },
    ],
    outputs: [{ name: 'stableObtained', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

export const LevierRouterABI = [
  {
    type: 'function',
    name: 'supplyCollateral',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'borrowDebt',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'repayDebt',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawCollateral',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const LevierPairABI = [
  {
    type: 'function',
    name: 'userPositions',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'collateral', type: 'uint256' },
      { name: 'borrowed', type: 'uint256' },
      { name: 'lastUpdated', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'collateralToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'debtToken',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'lltv',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export const LevierVaultABI = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'totalAssets',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'vaultSlug',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'riskTier',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

export const AutoProtectModuleABI = [
  {
    type: 'function',
    name: 'setProtectionRule',
    inputs: [
      { name: 'pair', type: 'address' },
      { name: 'triggerLtv', type: 'uint256' },
      { name: 'targetLtv', type: 'uint256' },
      { name: 'maxDeleverage', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getUserRule',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'pair', type: 'address' },
    ],
    outputs: [
      {
        components: [
          { name: 'triggerLtv', type: 'uint256' },
          { name: 'targetLtv', type: 'uint256' },
          { name: 'maxDeleverage', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
  },
] as const;
