import { z } from "zod";
import catalogJson from "../../../../data/chinese-equities-catalog.json";
import marketsJson from "../../../../data/chinese-equities-markets.json";
import proofsJson from "../../../../data/chinese-equities-proofs.json";
import positionsJson from "../../../../data/chinese-equities-positions.json";

// -------------------------------------------------------------
// 1. Zod Schemas & Types
// -------------------------------------------------------------

export const ChineseEquityAssetSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  symbol: z.string(),
  assetId: z.string(),
  company: z.string(),
  country: z.string(),
  isin: z.string(),
  cusip: z.string().optional(),
  productIsin: z.string().optional(),
  instrumentType: z.string(),
  depositaryStructure: z.string().optional(),
  depositaryRatio: z.string().optional(),
  underlyingExchange: z.string(),
  underlyingCurrency: z.string(),
  tokenIssuer: z.string().nullable().optional(),
  tokenAddress: z.string().nullable().optional(),
  targetChainId: z.number().nullable().optional(),
  decimals: z.number().nullable().optional(),
  image: z.string(),
  track: z.enum(["US_LISTED_ADR", "HONG_KONG_CANDIDATE", "MAINLAND_A_SHARE"]),
  verificationStatus: z.enum([
    "VERIFIED_NATIVE_IDENTITY",
    "VERIFIED_EXTERNAL_PRODUCT",
    "RESEARCH_ONLY",
    "VERIFIED_PILOT",
    "PENDING_REVIEW",
    "RESEARCH_QUEUE",
  ]),
  isPilotAsset: z.boolean(),
  featured: z.boolean().default(false),
  description: z.string(),
});

export type ChineseEquityAsset = z.infer<typeof ChineseEquityAssetSchema>;

export const ChineseEquityMarketSchema = z.object({
  id: z.string(),
  marketId: z.string().nullable().optional(),
  assetSymbol: z.string(),
  name: z.string(),
  company: z.string(),
  category: z.string(),
  instrumentType: z.string(),
  collateralToken: z.string(),
  debtToken: z.string(),
  collateralAddress: z.string().nullable().optional(),
  debtAssetAddress: z.string(),
  network: z.enum(["MAINNET", "TESTNET"]),
  chainId: z.number(),
  underlyingReferencePrice: z.number(),
  underlyingCurrency: z.string(),
  tokenReferencePriceUsd: z.number(),
  corporateActionMultiplier: z.number(),
  multiplierStatus: z.string(),
  executableBidPrice: z.number(),
  executableAskPrice: z.number(),
  spreadBps: z.number(),
  priceChange24hPercent: z.number(),
  high24hUsd: z.number(),
  low24hUsd: z.number(),
  high52WeekUsd: z.number().optional(),
  low52WeekUsd: z.number().optional(),
  marketCapUsd: z.string().optional(),
  historyClose30d: z.array(z.number()).optional(),
  volume24hUsd: z.number(),
  riskTier: z.enum(["Tier A", "Tier B", "Tier C"]),
  status: z.enum([
    "NORMAL",
    "CAUTION",
    "REDUCE_ONLY",
    "PAUSED",
    "PENDING_MAINNET",
    "UNACTIVATED",
  ]),
  marketSession: z.enum(["REGULAR", "PRE_MARKET", "AFTER_HOURS", "CLOSED"]),
  sessionLabel: z.string(),
  sessionTimeRemaining: z.string(),
  oracleStatus: z.enum([
    "HEALTHY",
    "WARNING",
    "STALE",
    "PAUSED",
    "UNVERIFIED",
    "PENDING_ACTIVATION",
  ]),
  oracleHeartbeatSeconds: z.number().nullable().optional(),
  chainHealth: z.enum(["HEALTHY", "DEGRADED", "HALTED"]),
  openingLtv: z.number(),
  liquidationThreshold: z.number(),
  maxLeverage: z.number(),
  liquidationPenaltyPercent: z.number(),
  borrowApr: z.number(),
  supplyApy: z.number(),
  debtCapUsd: z.number(),
  totalDebtUsd: z.number(),
  collateralCapTokens: z.number(),
  totalCollateralTokens: z.number(),
  availableLiquidityUsd: z.number(),
  utilizationPercent: z.number(),
  capabilities: z.object({
    spot: z.boolean(),
    collateral: z.boolean(),
    borrow: z.boolean(),
    long: z.boolean(),
    short: z.boolean(),
  }),
  disabledReasons: z.record(z.string()).optional(),
});

export type ChineseEquityMarket = z.infer<typeof ChineseEquityMarketSchema>;

export const ChineseEquityProofSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  assetId: z.string(),
  tokenIssuer: z.string(),
  issuerEntityRegistration: z.string(),
  issuerLegalStructure: z.string(),
  tokenholderEntitlement: z.string(),
  custodyAndBacking: z.string(),
  corporateActionPolicy: z.string(),
  transferRestrictions: z.string(),
  contractAddress: z.string().nullable().optional(),
  contractBytecodeSha256: z.string().nullable().optional(),
  chainlinkFeedAddress: z.string().nullable().optional(),
  oracleMethodology: z.string(),
  lastVerificationDate: z.string(),
  verifiedBy: z.string(),
  governanceEvidenceHash: z.string().nullable().optional(),
  documentationUrl: z.string(),
});

export type ChineseEquityProof = z.infer<typeof ChineseEquityProofSchema>;

export const ChineseEquityPositionSchema = z.object({
  id: z.string(),
  marketId: z.string().nullable().optional(),
  assetSymbol: z.string(),
  name: z.string(),
  positionType: z.enum(["LONG", "SHORT", "COLLATERAL_BORROW", "SPOT"]),
  leverage: z.number(),
  collateralTokens: z.number(),
  collateralUsd: z.number(),
  debtUsd: z.number(),
  equityUsd: z.number(),
  entryPrice: z.number(),
  markPrice: z.number(),
  liquidationPrice: z.number(),
  healthFactor: z.number(),
  currentLtv: z.number(),
  liquidationThreshold: z.number(),
  pnlUsd: z.number(),
  pnlPercent: z.number(),
  accruedInterestUsd: z.number(),
  openedAt: z.string(),
  closedAt: z.string().nullable().optional(),
  closeTxHash: z.string().nullable().optional(),
  status: z.enum(["HEALTHY", "WARNING", "CRITICAL", "CLOSED"]),
  riskTier: z.string(),
});

export type ChineseEquityPosition = z.infer<typeof ChineseEquityPositionSchema>;

// -------------------------------------------------------------
// 2. Parsed Data Exports
// -------------------------------------------------------------

export const chineseEquitiesCatalog: ChineseEquityAsset[] = z
  .array(ChineseEquityAssetSchema)
  .parse(catalogJson);

export const chineseEquitiesMarkets: ChineseEquityMarket[] = z
  .array(ChineseEquityMarketSchema)
  .parse(marketsJson);

export const chineseEquitiesProofs: ChineseEquityProof[] = z
  .array(ChineseEquityProofSchema)
  .parse(proofsJson);

export const initialChineseEquitiesPositions: ChineseEquityPosition[] = z
  .array(ChineseEquityPositionSchema)
  .parse(positionsJson);

const POSITIONS_STORAGE_KEY = "levera_chinese_positions_v1";

export function loadStoredChinesePositions(): ChineseEquityPosition[] {
  if (typeof window === "undefined") return initialChineseEquitiesPositions;
  try {
    const raw = localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return initialChineseEquitiesPositions;
    const parsed = JSON.parse(raw);
    return z.array(ChineseEquityPositionSchema).parse(parsed);
  } catch {
    return initialChineseEquitiesPositions;
  }
}

export function saveStoredChinesePositions(positions: ChineseEquityPosition[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {}
}

// -------------------------------------------------------------
// 3. Helper Lookup Functions
// -------------------------------------------------------------

export function getChineseAssetBySymbol(symbol: string): ChineseEquityAsset | undefined {
  const norm = symbol.trim().toUpperCase();
  return chineseEquitiesCatalog.find((a) => a.symbol.toUpperCase() === norm);
}

export function getChineseMarketBySymbol(symbol: string): ChineseEquityMarket | undefined {
  const norm = symbol.trim().toUpperCase();
  return chineseEquitiesMarkets.find((m) => m.assetSymbol.toUpperCase() === norm);
}

export function getChineseProofBySymbol(symbol: string): ChineseEquityProof | undefined {
  const norm = symbol.trim().toUpperCase();
  return chineseEquitiesProofs.find((p) => p.symbol.toUpperCase() === norm);
}

export function chinaMarketPath(symbol: string): string {
  return `/markets/china/${encodeURIComponent(symbol.toLowerCase())}`;
}

// -------------------------------------------------------------
// 4. Financial Calculations (Strict & Checked)
// -------------------------------------------------------------

/**
 * LTV = Debt / Collateral Value
 */
export function calculateLtv(debtUsd: number, collateralUsd: number): number {
  if (collateralUsd <= 0) return 0;
  return Math.min(100, (debtUsd / collateralUsd) * 100);
}

/**
 * Health Factor = (Collateral Value * Liquidation Threshold %) / Debt Value
 */
export function calculateHealthFactor(
  collateralUsd: number,
  liquidationThresholdPercent: number,
  debtUsd: number
): number {
  if (debtUsd <= 0) return 99.99; // Represents infinite / no debt
  const thresholdFactor = liquidationThresholdPercent / 100;
  const hf = (collateralUsd * thresholdFactor) / debtUsd;
  return Number(hf.toFixed(2));
}

/**
 * Estimated Liquidation Price = Debt / (Collateral Tokens * Liquidation Threshold %)
 */
export function calculateLiquidationPrice(
  debtUsd: number,
  collateralTokens: number,
  liquidationThresholdPercent: number
): number {
  if (collateralTokens <= 0 || debtUsd <= 0 || liquidationThresholdPercent <= 0) return 0;
  const thresholdFactor = liquidationThresholdPercent / 100;
  const liqPrice = debtUsd / (collateralTokens * thresholdFactor);
  return Number(liqPrice.toFixed(2));
}

/**
 * Max Borrow Capacity = Collateral Value * (Opening LTV % / 100)
 */
export function calculateMaxBorrowCapacity(
  collateralUsd: number,
  openingLtvPercent: number
): number {
  if (collateralUsd <= 0) return 0;
  return collateralUsd * (openingLtvPercent / 100);
}

/**
 * Gross Long Leverage = Total Exposure / User Margin Equity
 */
export function calculateGrossLeverage(exposureUsd: number, equityUsd: number): number {
  if (equityUsd <= 0) return 1.0;
  return Number((exposureUsd / equityUsd).toFixed(2));
}

// -------------------------------------------------------------
// 5. Formatting Utilities
// -------------------------------------------------------------

export function formatCurrency(amount: number, digits: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

export function formatPercent(value: number, includeSign: boolean = false): string {
  const sign = includeSign && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatTokens(amount: number, decimals: number = 4): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatUnderlyingPrice(price: number, currency: string = "USD"): string {
  if (!price || price <= 0) return "—";
  if (currency === "HKD") return `HK$${price.toFixed(2)}`;
  if (currency === "CNY") return `¥${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}
