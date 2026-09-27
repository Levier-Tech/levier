import { createRequire } from "node:module";
import { assert, same, v } from "./rh-live.mjs";
const { z } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("zod");
const amount = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((x) => BigInt(x) < 2n ** 256n);

export function expansionScopeHash(draft) {
  assert(
    draft.version === 1 &&
      draft.chainId === 46630 &&
      draft.mode === "PREPARATION_ONLY",
    "INVALID_EXPANSION_SCOPE",
  );
  const keys = [
    "symbol",
    "stock",
    "stockCodeHash",
    "uid",
    "multiplier18",
    "longSlug",
    "shortSlug",
    "bindingHash",
    "seedStableRaw",
    "longLiquidityRaw",
    "shortLiquidityRaw",
    "proposedMaxSeedStockRaw",
    "longRisk",
    "shortRisk",
  ];
  const globalKeys = [
    "chainId",
    "owner",
    "publisher",
    "stable",
    "registry",
    "factory",
    "registryCodeHash",
    "factoryCodeHash",
    "poolCodeHash",
    "stableCodeHash",
    "slippageBps",
    "deadlineSeconds",
  ];
  const value = Object.fromEntries(
    globalKeys.map((key) => {
      assert(draft[key] !== undefined, "MISSING_SCOPE_FIELD");
      return [key, draft[key]];
    }),
  );
  value.markets = draft.markets.map((market) =>
    Object.fromEntries(
      keys.map((key) => {
        assert(market[key] !== undefined, "MISSING_SCOPE_FIELD");
        return [key, market[key]];
      }),
    ),
  );
  return v.keccak256(v.toHex(JSON.stringify(value)));
}
export function parseExpansionReviewPolicy(raw, symbols) {
  const schema = z
    .object({
      version: z.literal(1),
      approvedForBroadcast: z.literal(false),
      gasEstimateMultiplier: z.number().int().min(100).max(200),
      maxRunSeconds: z.number().int().min(1).max(600),
      maxSeedStockRaw: z.record(amount),
    })
    .strict();
  const result = schema.parse(JSON.parse(raw));
  assert(
    JSON.stringify(Object.keys(result.maxSeedStockRaw).sort()) ===
      JSON.stringify([...symbols].sort()),
    "REVIEW_SCOPE_MISMATCH",
  );
  return result;
}
export function acceptanceCollateralRaw(
  debtRaw,
  stockPrice18,
  debtPrice18,
  maxLtvBps,
) {
  for (const value of [debtRaw, stockPrice18, debtPrice18])
    amount.parse(String(value));
  assert(
    BigInt(maxLtvBps) > 0n && BigInt(maxLtvBps) < 10000n,
    "INVALID_ACCEPTANCE_LTV",
  );
  // Target half the maximum LTV, with upward rounding in the collateral's raw units.
  const denominator = 10n ** 6n * BigInt(stockPrice18) * BigInt(maxLtvBps);
  return (
    (BigInt(debtRaw) * BigInt(debtPrice18) * 10n ** 18n * 20000n +
      denominator -
      1n) /
    denominator
  );
}
export function minimumSeedLiquidity(stockRaw, stableRaw, slippageBps) {
  amount.parse(String(stockRaw));
  amount.parse(String(stableRaw));
  assert(
    Number.isSafeInteger(slippageBps) && slippageBps > 0 && slippageBps <= 100,
    "INVALID_SEED_SLIPPAGE",
  );
  const product = BigInt(stockRaw) * BigInt(stableRaw);
  let root = product,
    next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + product / root) / 2n;
  }
  // Uniswap V2 permanently locks MINIMUM_LIQUIDITY (1000 LP raw units).
  const minimum = ((root - 1000n) * BigInt(10000 - slippageBps)) / 10000n;
  assert(minimum > 0n, "INVALID_LP_MINIMUM");
  return minimum;
}
export function summarizePreparedTransactions(
  generated,
  owner,
  publisher,
  gasPrice,
) {
  assert(
    Number(generated.chain) === 46630 &&
      Array.isArray(generated.receipts) &&
      generated.receipts.length === 0 &&
      Array.isArray(generated.pending) &&
      generated.pending.length === 0,
    "NOT_A_DRY_RUN_ARTIFACT",
  );
  assert(
    !same(owner, publisher) &&
      !same(owner, v.zeroAddress) &&
      !same(publisher, v.zeroAddress),
    "SEPARATE_SIGNERS_REQUIRED",
  );
  assert(
    BigInt(gasPrice) > 0n &&
      Array.isArray(generated.transactions) &&
      generated.transactions.length > 0,
    "EMPTY_GAS_ESTIMATE",
  );
  const costs = { deployer: 0n, publisher: 0n };
  let maxTxCost = 0n;
  const operations = generated.transactions.map((op, index) => {
    const tx = op.transaction,
      signer = same(tx.from, owner)
        ? "deployer"
        : same(tx.from, publisher)
          ? "publisher"
          : null;
    assert(
      signer &&
        BigInt(tx.value) === 0n &&
        Number(BigInt(tx.chainId)) === 46630 &&
        BigInt(tx.gas) > 0n &&
        BigInt(tx.gas) < 2n ** 64n,
      "UNEXPECTED_PREPARED_TRANSACTION",
    );
    const fee = BigInt(tx.gas) * BigInt(gasPrice);
    costs[signer] += fee;
    if (fee > maxTxCost) maxTxCost = fee;
    return {
      index,
      signer,
      kind: op.transactionType,
      contract: op.contractName,
      function: op.function,
      gas: String(BigInt(tx.gas)),
      estimatedFeeWei: String(fee),
    };
  });
  assert(
    costs.deployer > 0n && costs.publisher > 0n,
    "MISSING_SIGNER_ESTIMATE",
  );
  return { costs, maxTxCost, operations };
}
