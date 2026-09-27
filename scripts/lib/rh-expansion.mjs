import { createRequire } from "node:module";
import { assert, same, v } from "./rh-live.mjs";

const { z } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("zod");
const amount = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((x) => BigInt(x) < 2n ** 256n);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((x) => !same(x, v.zeroAddress));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const age = z.number().int().min(1).max(3600);
const bounds = z
  .object({
    stockMaxAgeSeconds: age,
    debtMaxAgeSeconds: age,
    maxSpreadBps: z.number().int().min(1).max(10000),
    stockMin18: amount,
    stockMax18: amount,
    debtMin18: amount,
    debtMax18: amount,
    maxDeviationBps: z.number().int().min(1).max(1000),
  })
  .refine(
    (x) =>
      BigInt(x.stockMin18) < BigInt(x.stockMax18) &&
      BigInt(x.debtMin18) < BigInt(x.debtMax18),
  );
const planSchema = z
  .object({
    version: z.literal(1),
    chainId: z.literal(46630),
    assets: z
      .array(
        z
          .object({
            symbol: z.string(),
            seedStableRaw: amount,
            longLiquidityRaw: amount,
            shortLiquidityRaw: amount,
            maxSeedStockRaw: amount,
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

export function parseExpansionPlan(env, scope) {
  assert(
    env.NETWORK_MODE === "TESTNET" && env.CHAIN_ID === "46630",
    "EXPANSION_TESTNET_ONLY",
  );
  const plan = planSchema.parse(JSON.parse(env.RH_MARKET_EXPANSION_PLAN_JSON));
  const expected = scope
    .filter((x) => !x.long && !x.margin)
    .map((x) => x.symbol)
    .sort();
  assert(
    JSON.stringify(plan.assets.map((x) => x.symbol).sort()) ===
      JSON.stringify(expected),
    "EXPANSION_SCOPE_MISMATCH",
  );
  return plan;
}

// Copy only explicit, validated policy fields. Never inherit the TSLA identity.
export function buildExpansionBinding(
  template,
  row,
  assets,
  snapshot,
  debtFingerprint,
) {
  assert(
    template.mode === "RH_TESTNET_REAL_REFERENCE" && template.chainId === 46630,
    "EXPANSION_TESTNET_ONLY",
  );
  assert(
    template.stockApiUrl === "https://api.robinhood.com/rhj/" &&
      template.usdgBookUrl === "wss://ws.kraken.com/v2",
    "SOURCE_IDENTITY_MISMATCH",
  );
  const policy = bounds.parse(template);
  address.parse(row.token);
  address.parse(template.debt);
  assert(!same(row.token, template.debt), "TOKEN_IDENTITIES_MUST_DIFFER");
  assert(
    row.symbol === snapshot.symbol &&
      snapshot.decimals === 18 &&
      row.tokenSourceConfigured,
    "TOKEN_METADATA_MISMATCH",
  );
  assert(
    same(snapshot.fingerprint.address, row.token) &&
      same(debtFingerprint.address, template.debt),
    "TOKEN_FINGERPRINT_MISMATCH",
  );
  const matches = assets.assets.filter((x) => x.tokenSymbol === row.symbol);
  assert(matches.length === 1, "SOURCE_ASSET_AMBIGUOUS");
  const source = matches[0];
  hash.parse(source.id);
  hash.parse(snapshot.uid);
  amount.parse(snapshot.multiplier18);
  assert(
    source.status === "ASSET_STATUS_ACTIVE" && source.pendingMultiplier === "",
    "SOURCE_ASSET_INACTIVE",
  );
  assert(
    /^(0|[1-9]\d*)(\.\d{1,18})?$/.test(source.currentMultiplier) &&
      v.parseUnits(source.currentMultiplier, 18) ===
        BigInt(snapshot.multiplier18),
    "SOURCE_MULTIPLIER_MISMATCH",
  );
  return {
    mode: template.mode,
    chainId: template.chainId,
    stockApiUrl: template.stockApiUrl,
    usdgBookUrl: template.usdgBookUrl,
    stockSourceId: source.id,
    stockSymbol: row.symbol,
    collateral: row.token,
    debt: template.debt,
    // The official faucet UID and underlying reference ID are intentionally distinct.
    testnetStockUid: snapshot.uid,
    multiplier18: snapshot.multiplier18,
    ...policy,
    tokenFingerprints: {
      collateral: snapshot.fingerprint,
      debt: debtFingerprint,
    },
  };
}

export function seedRequirements(plan, report, stockBalanceRaw) {
  for (const key of [
    "seedStableRaw",
    "longLiquidityRaw",
    "shortLiquidityRaw",
    "maxSeedStockRaw",
  ])
    amount.parse(plan[key]);
  amount.parse(report.collateralPrice18);
  amount.parse(report.debtPrice18);
  assert(BigInt(stockBalanceRaw) >= 0n, "NEGATIVE_TOKEN_BALANCE");
  // Match MarginRouter's initial pool seeding arithmetic exactly (stock 18 / USDG 6).
  const seed =
    (BigInt(plan.seedStableRaw) * BigInt(report.debtPrice18) * 10n ** 18n) /
    (10n ** 6n * BigInt(report.collateralPrice18));
  assert(seed > 0n, "SEED_ROUNDS_TO_ZERO");
  const total = seed + BigInt(plan.shortLiquidityRaw);
  const cap = BigInt(plan.maxSeedStockRaw);
  return {
    seedStockRaw: String(seed),
    seedStock: v.formatUnits(seed, 18),
    totalStockRaw: String(total),
    totalStock: v.formatUnits(total, 18),
    stockBalanceCovered: BigInt(stockBalanceRaw) >= total,
    configuredSeedCap: v.formatUnits(cap, 18),
    seedCapCovered: cap >= seed,
    seedCapShortfall: v.formatUnits(seed > cap ? seed - cap : 0n, 18),
    requiredUsdg: v.formatUnits(
      BigInt(plan.seedStableRaw) + BigInt(plan.longLiquidityRaw),
      6,
    ),
  };
}

export function assertFreshReport(binding, report, nowSeconds) {
  assert(Number.isSafeInteger(nowSeconds), "INVALID_SOURCE_CLOCK");
  for (const [timestamp, maxAge] of [
    [report.collateralTimestamp, binding.stockMaxAgeSeconds],
    [report.debtTimestamp, binding.debtMaxAgeSeconds],
  ]) {
    assert(
      Number.isSafeInteger(timestamp) &&
        timestamp > 0 &&
        nowSeconds >= timestamp &&
        nowSeconds - timestamp <= maxAge,
      "EXPANSION_SOURCE_EXPIRED",
    );
  }
}

export function referenceOracleArgs(binding, publisher) {
  address.parse(publisher);
  const policy = bounds.parse(binding);
  return [
    publisher,
    v.keccak256(v.toHex(JSON.stringify(binding))),
    [
      binding.collateral,
      BigInt(policy.stockMaxAgeSeconds),
      BigInt(policy.stockMin18),
      BigInt(policy.stockMax18),
    ],
    [
      binding.debt,
      BigInt(policy.debtMaxAgeSeconds),
      BigInt(policy.debtMin18),
      BigInt(policy.debtMax18),
    ],
    BigInt(policy.maxDeviationBps),
  ];
}
