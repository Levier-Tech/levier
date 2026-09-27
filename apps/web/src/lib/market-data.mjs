import { z } from "zod";
const number = z
  .union([z.number(), z.string().min(1)])
  .pipe(z.coerce.number().finite().nonnegative());
const market = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["Equities", "ETFs", "Stablecoins"]),
  asset_symbol: z.string().min(1),
  collateral_token: z.string().min(1),
  debt_token: z.string().min(1),
  pair_address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .nullish(),
  network: z.enum(["TESTNET", "MAINNET"]),
  mark_price: number,
  max_ltv: number,
  liquidation_ltv: number,
  max_leverage: number,
  supply_apy: number,
  borrow_apr: number,
  total_supply_usd: number,
  total_borrow_usd: number,
  available_liquidity_usd: number,
  risk_tier: z.enum(["Tier A", "Tier B", "Tier C"]),
  status: z.enum(["NORMAL", "CAUTION", "REDUCE_ONLY", "PAUSED"]),
});
export function parseMarketRows(rows, network) {
  const result = z.array(market).safeParse(rows);
  if (!result.success || result.data.some((row) => row.network !== network))
    throw new Error(
      "Market response is incomplete or belongs to a different network",
    );
  return result.data
    .sort((a, b) => a.asset_symbol.localeCompare(b.asset_symbol))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      assetSymbol: row.asset_symbol,
      collateralToken: row.collateral_token,
      debtToken: row.debt_token,
      pairAddress: row.pair_address ?? undefined,
      network: row.network,
      markPrice: row.mark_price,
      maxLtv: row.max_ltv,
      liquidationLtv: row.liquidation_ltv,
      maxLeverage: row.max_leverage,
      supplyApy: row.supply_apy,
      borrowApr: row.borrow_apr,
      totalSupplyUsd: row.total_supply_usd,
      totalBorrowUsd: row.total_borrow_usd,
      availableLiquidityUsd: row.available_liquidity_usd,
      riskTier: row.risk_tier,
      status: row.status,
    }));
}
