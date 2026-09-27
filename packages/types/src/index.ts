export type NetworkMode = 'TESTNET' | 'MAINNET';

export type PositionType = 'LONG' | 'SHORT' | 'MULTIPLY' | 'COLLATERAL';

export interface TokenConfig {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  network: NetworkMode;
  address: string;
  isStablecoin: boolean;
  category?: string;
}

export type MarketStatus = 'NORMAL' | 'CAUTION' | 'REDUCE_ONLY' | 'PAUSED';

export interface MarketConfig {
  id: string;
  slug: string;
  assetSymbol: string;
  name: string;
  category: 'Equities' | 'ETFs' | 'Stablecoins';
  collateralToken: string;
  debtToken: string;
  pairAddress?: string;
  network: NetworkMode;
  markPrice: number;
  maxLtv: number;
  liquidationLtv: number;
  maxLeverage: number;
  supplyApy: number;
  borrowApr: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  availableLiquidityUsd: number;
  riskTier: 'Tier A' | 'Tier B' | 'Tier C';
  status: MarketStatus;
}

export interface VaultAllocation {
  symbol: string;
  weightPercent: number;
}

export interface VaultConfig {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  network: NetworkMode;
  assetSymbol: string;
  apy: number;
  tvlUsd: number;
  utilizationRate: number;
  riskTier: string;
  allocations: VaultAllocation[];
  description?: string;
}

export interface Position {
  id: string;
  assetSymbol: string;
  positionType: PositionType;
  network: NetworkMode;
  leverage: number;
  equityUsd: number;
  exposureUsd: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  healthFactor: number;
  pnlUsd: number;
  pnlPercent: number;
}

export interface PortfolioSummary {
  portfolioValueUsd: number;
  collateralUsd: number;
  debtUsd: number;
  netEquityUsd: number;
  borrowingPowerUsd: number;
  weightedLtvPercent: number;
  healthFactor: number;
  pnl24hUsd: number;
}

export interface AutoProtectConfig {
  isEnabled: boolean;
  triggerLtvPercent: number;
  targetLtvPercent: number;
  maxDeleverageUsd: number;
}

export interface User {
  id: string;
  network: NetworkMode;
  walletAddress: string;
  ensName?: string | null;
  lastLoginAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LiquidationCluster {
  priceLevel: number;
  formattedPrice: string;
  atRiskDebtUsd: number;
  atRiskCollateralUsd: number;
  positionCount: number;
  side: 'LONG' | 'SHORT';
  distancePercent: number;
  isCritical: boolean; // within 5% of current price
  relativeIntensity: number; // 0 to 1 for heatmap bar sizing
}

export interface LiquidationHeatmapData {
  assetSymbol: string;
  markPrice: number;
  network: NetworkMode;
  marketStatus: MarketStatus;
  clusters: LiquidationCluster[];
  summary: {
    totalPositionsAtRisk: number;
    totalDebtAtRiskUsd: number;
    totalCollateralAtRiskUsd: number;
    highestRiskPriceLevel: number;
    closestLiquidationDistancePercent: number;
  };
}

export interface ProtocolRiskStats {
  network: NetworkMode;
  totalOpenInterestUsd: number;
  longOpenInterestUsd: number;
  shortOpenInterestUsd: number;
  longRatioPercent: number;
  shortRatioPercent: number;
  totalActivePositions: number;
  totalCollateralLockedUsd: number;
  estimated24hLiquidationVolumeUsd: number;
}

export interface MarketRiskState {
  status: MarketStatus;
  isTradingOpen: boolean;
  sessionName: 'REGULAR' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED_OVERNIGHT' | 'WEEKEND_HOLIDAY' | 'CIRCUIT_BREAKER';
  effectiveMaxLtvMultiplier: number; // 1.0 for normal, 0.9 for caution, 0 for paused
  reason: string;
}
