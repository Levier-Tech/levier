import { erc20Abi, keccak256, parseAbi, type PublicClient } from "viem";
import { z } from "zod";
import {
  LevierPairABI,
  LevierMarketRegistryABI,
} from "../contracts/generated/lending";
import { MarginRouterABI } from "../contracts/generated/margin";
import { readLendingSnapshot, type LendingDeployment } from "./lending-client";
import { snapshotClient } from "./snapshot-client";
import type { MarginDeployment } from "./margin-client";

const raw = z.string().regex(/^\d+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const metricSchema = z
  .object({
    collateralRaw: raw,
    debtRaw: raw,
    liquidityRaw: raw,
    collateralPrice18: raw.nullable(),
    debtPrice18: raw.nullable(),
    collateralUsd18: raw.nullable(),
    debtUsd18: raw.nullable(),
    utilizationBps: z.number().int().min(0).max(10000).nullable(),
    status: z.enum(["NORMAL", "REDUCE_ONLY", "PAUSED"]),
    maxLtvBps: raw,
    liquidationLtvBps: raw,
    supplyCapRaw: raw,
    borrowCapRaw: raw,
  })
  .strict();
const poolSchema = z
  .object({
    address,
    stockSymbol: z.string(),
    stableSymbol: z.string(),
    stockDecimals: z.number(),
    stableDecimals: z.number(),
    reserves: z
      .object({
        stockRaw: raw,
        stableRaw: raw,
        routerPaused: z.boolean(),
        routerAuthorized: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const analyticsSchema = z
  .object({
    chainId: z.literal(46630),
    blockNumber: raw,
    blockHash: hash,
    blockTimestamp: raw,
    capturedAt: z.string().datetime(),
    markets: z.array(
      z
        .object({
          id: hash,
          label: z.string(),
          pair: address,
          collateralSymbol: z.string(),
          debtSymbol: z.string(),
          collateralDecimals: z.number().int().min(0).max(36),
          debtDecimals: z.number().int().min(0).max(36),
          metrics: metricSchema.nullable(),
        })
        .strict(),
    ),
    pool: poolSchema.nullable(),
    pools: z.array(poolSchema),
    totals: z
      .object({
        collateralUsd18: raw.nullable(),
        debtUsd18: raw.nullable(),
        verifiedMarkets: z.number().int(),
        configuredMarkets: z.number().int(),
      })
      .strict(),
  })
  .strict();
export type AnalyticsSnapshot = z.infer<typeof analyticsSchema>;
export type AnalyticsMarket = { label: string; deployment: LendingDeployment };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const priceAbi = parseAbi([
  "function getPrice(address) view returns (uint256)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function factory() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
]);

export function aggregateMetrics(markets: AnalyticsSnapshot["markets"]) {
  const sum = (key: "collateralUsd18" | "debtUsd18") =>
    markets.length === 0 || markets.some((m) => m.metrics?.[key] == null)
      ? null
      : String(
          markets.reduce((total, m) => total + BigInt(m.metrics![key]!), 0n),
        );
  return {
    collateralUsd18: sum("collateralUsd18"),
    debtUsd18: sum("debtUsd18"),
    verifiedMarkets: markets.filter((m) => m.metrics !== null).length,
    configuredMarkets: markets.length,
  };
}

export async function readAnalyticsSnapshot(
  client: PublicClient,
  configured: AnalyticsMarket[],
  confirmations: number,
  margin:
    | { deployment: MarginDeployment; long: LendingDeployment }
    | { deployment: MarginDeployment; long: LendingDeployment }[]
    | null,
  maxBlockAgeSeconds: number,
) {
  if (
    (await client.getChainId()) !== 46630 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    !Number.isSafeInteger(maxBlockAgeSeconds) ||
    maxBlockAgeSeconds < 1 ||
    !configured.length ||
    configured.length > 32 ||
    new Set(configured.map((x) => x.deployment.pair.toLowerCase())).size !==
      configured.length
  )
    throw Error("INVALID_ANALYTICS_SCOPE");
  const margins =
    margin === null ? [] : Array.isArray(margin) ? margin : [margin];
  if (
    margins.length > 16 ||
    new Set(margins.map((m) => m.deployment.pool.toLowerCase())).size !==
      margins.length ||
    margins.some(
      (m) =>
        !configured.some((c) => same(c.deployment.pair, m.long.pair)) ||
        !configured.some((c) =>
          same(c.deployment.pair, m.deployment.short.pair),
        ),
    )
  )
    throw Error("INVALID_ANALYTICS_POOL_SCOPE");
  client = snapshotClient(client);
  const head = await client.getBlockNumber();
  const blockNumber = head - BigInt(confirmations) + 1n;
  if (blockNumber < 0n) throw Error("CONFIRMED_BLOCK_UNAVAILABLE");
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw Error("CONFIRMED_BLOCK_UNAVAILABLE");
  const assertFresh = () => {
    const age = BigInt(Math.floor(Date.now() / 1000)) - block.timestamp;
    if (age < 0n || age > BigInt(maxBlockAgeSeconds))
      throw Error("ANALYTICS_BLOCK_NOT_FRESH");
  };
  assertFresh();
  const markets = await Promise.all(
    configured.map(async ({ label, deployment: d }) => {
      const row = {
        id: d.marketId,
        label,
        pair: d.pair,
        collateralSymbol: d.collateralSymbol,
        debtSymbol: d.debtSymbol,
        collateralDecimals: d.collateralDecimals,
        debtDecimals: d.debtDecimals,
      };
      try {
        // Reuse contract/registry/token identity validation at the same confirmed block.
        await readLendingSnapshot(client, d, d.pair, blockNumber);
        const [collateral, debt, liquidity, market, prices] = await Promise.all(
          [
            client.readContract({
              address: d.pair,
              abi: LevierPairABI,
              functionName: "totalSupplyCollateral",
              blockNumber,
            }),
            client.readContract({
              address: d.pair,
              abi: LevierPairABI,
              functionName: "totalBorrowedDebt",
              blockNumber,
            }),
            client.readContract({
              address: d.debt,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [d.pair],
              blockNumber,
            }),
            client.readContract({
              address: d.registry,
              abi: LevierMarketRegistryABI,
              functionName: "getMarket",
              args: [d.marketId],
              blockNumber,
            }),
            Promise.allSettled(
              [d.collateral, d.debt].map((asset) =>
                client.readContract({
                  address: d.oracle,
                  abi: priceAbi,
                  functionName: "getPrice",
                  args: [asset],
                  blockNumber,
                }),
              ),
            ),
          ],
        );
        const price = (i: number) => {
          const p = prices[i];
          return p.status === "fulfilled" && p.value > 0n ? p.value : null;
        };
        const cp = price(0),
          dp = price(1),
          status = (["NORMAL", "REDUCE_ONLY", "PAUSED"] as const)[
            market.status
          ];
        if (!status) throw Error("UNKNOWN_MARKET_STATUS");
        return {
          ...row,
          metrics: {
            collateralRaw: String(collateral),
            debtRaw: String(debt),
            liquidityRaw: String(liquidity),
            collateralPrice18: cp === null ? null : String(cp),
            debtPrice18: dp === null ? null : String(dp),
            collateralUsd18:
              cp === null
                ? null
                : String(
                    (collateral * cp) / 10n ** BigInt(d.collateralDecimals),
                  ),
            debtUsd18:
              dp === null
                ? null
                : String(
                    (debt * dp + 10n ** BigInt(d.debtDecimals) - 1n) /
                      10n ** BigInt(d.debtDecimals),
                  ),
            utilizationBps:
              debt + liquidity === 0n
                ? null
                : Number((debt * 10000n) / (debt + liquidity)),
            status,
            maxLtvBps: String(market.maxLtvBps),
            liquidationLtvBps: String(market.liquidationLtvBps),
            supplyCapRaw: String(market.supplyCap),
            borrowCapRaw: String(market.borrowCap),
          },
        };
      } catch {
        return { ...row, metrics: null };
      }
    }),
  );
  const pools: AnalyticsSnapshot["pools"] = [];
  for (const margin of margins) {
    const { deployment: d, long } = margin;
    const pool: AnalyticsSnapshot["pools"][number] = {
      address: d.pool,
      stockSymbol: long.collateralSymbol,
      stableSymbol: long.debtSymbol,
      stockDecimals: long.collateralDecimals,
      stableDecimals: long.debtDecimals,
      reserves: null,
    };
    try {
      if (
        d.chainId !== 46630 ||
        !same(d.longPair, long.pair) ||
        !same(d.short.collateral, long.debt) ||
        !same(d.short.debt, long.collateral)
      )
        throw Error("POOL_BINDING_MISMATCH");
      for (const role of ["pool", "factory", "router"] as const) {
        const code = await client.getCode({ address: d[role], blockNumber });
        if (!code || !same(keccak256(code), d.codeHashes[role]))
          throw Error("POOL_CODE_MISMATCH");
      }
      const [
        token0,
        token1,
        factory,
        reserves,
        paused,
        authorized,
        routerPool,
      ] = await Promise.all([
        client.readContract({
          address: d.pool,
          abi: poolAbi,
          functionName: "token0",
          blockNumber,
        }),
        client.readContract({
          address: d.pool,
          abi: poolAbi,
          functionName: "token1",
          blockNumber,
        }),
        client.readContract({
          address: d.pool,
          abi: poolAbi,
          functionName: "factory",
          blockNumber,
        }),
        client.readContract({
          address: d.pool,
          abi: poolAbi,
          functionName: "getReserves",
          blockNumber,
        }),
        client.readContract({
          address: d.router,
          abi: MarginRouterABI,
          functionName: "isPaused",
          blockNumber,
        }),
        client.readContract({
          address: long.registry,
          abi: LevierMarketRegistryABI,
          functionName: "isAuthorizedRouter",
          args: [d.router],
          blockNumber,
        }),
        client.readContract({
          address: d.router,
          abi: MarginRouterABI,
          functionName: "pool",
          blockNumber,
        }),
      ]);
      if (
        !same(factory, d.factory) ||
        !same(routerPool, d.pool) ||
        !(
          (same(token0, long.collateral) && same(token1, long.debt)) ||
          (same(token1, long.collateral) && same(token0, long.debt))
        )
      )
        throw Error("POOL_BINDING_MISMATCH");
      pool.reserves = {
        stockRaw: String(reserves[same(token0, long.collateral) ? 0 : 1]),
        stableRaw: String(reserves[same(token0, long.collateral) ? 1 : 0]),
        routerPaused: paused,
        routerAuthorized: authorized,
      };
    } catch {
      /* Keep unavailable distinct from an empty pool. */
    }
    pools.push(pool);
  }
  if ((await client.getBlock({ blockNumber })).hash !== block.hash)
    throw Error("ANALYTICS_REORG");
  assertFresh();
  return analyticsSchema.parse({
    chainId: 46630,
    blockNumber: String(blockNumber),
    blockHash: block.hash,
    blockTimestamp: String(block.timestamp),
    capturedAt: new Date().toISOString(),
    markets,
    pool: pools[0] ?? null,
    pools,
    totals: aggregateMetrics(markets),
  });
}
