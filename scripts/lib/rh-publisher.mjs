import { parseReferenceTransport } from "../../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../../apps/price-oracle/src/services/robinhoodTransport.ts";
import { createRequire } from "node:module";
import {
  artifact,
  assert,
  same,
  json,
  save,
  verifyBinding,
  verifyRuntime,
  submit,
  v,
} from "./rh-live.mjs";
const requireOracle = createRequire(
  new URL("../../apps/price-oracle/package.json", import.meta.url),
);
const { z } = requireOracle("zod");
export function marketReferenceContext(ctx, symbol) {
  if (symbol === "TSLA") return ctx;
  assert(
    ["AMZN", "PLTR", "NFLX", "AMD"].includes(symbol),
    "UNKNOWN_REFERENCE_MARKET",
  );
  const entry = ctx.state.expansion?.[symbol];
  const long = entry?.descriptor?.long;
  const binding = JSON.parse(ctx.env[`RH_${symbol}_REFERENCE_BINDING_JSON`]);
  assert(
    entry?.deploymentComplete &&
      long &&
      binding.stockSymbol === symbol &&
      same(binding.collateral, long.collateral) &&
      same(binding.debt, long.debt) &&
      same(entry.bindingHash, v.keccak256(v.toHex(JSON.stringify(binding)))),
    "REFERENCE_MARKET_IDENTITY_MISMATCH",
  );
  // All journal writes, including its gas anchor, reach the root persist closure.
  const referenceFields = {
    descriptor: long,
    oracle: long.oracle,
    oracleCodeHash: long.codeHashes.oracle,
  };
  return {
    ...ctx,
    env: { ...ctx.env, RH_REFERENCE_BINDING_JSON: JSON.stringify(binding) },
    state: new Proxy(ctx.state, {
      get: (target, key) =>
        Object.hasOwn(referenceFields, key)
          ? referenceFields[key]
          : target[key],
      set: (target, key, value) => {
        assert(
          !Object.hasOwn(referenceFields, key),
          "REFERENCE_IDENTITY_READ_ONLY",
        );
        target[key] = value;
        return true;
      },
    }),
  };
}
export function publisherPolicy(raw, binding) {
  const parsed = z
    .object({
      intervalMs: z.number().int().min(1000),
      maxRunSeconds: z.number().int().positive().max(86400),
      maxPublications: z.number().int().positive().max(2880),
      maxConsecutiveFailures: z.number().int().positive().max(10),
      maxTransactionGasCostWei: z.string().regex(/^[1-9]\d*$/),
      maxGasCostWei: z.string().regex(/^[1-9]\d*$/),
      minimumFreshSeconds: z.number().int().positive(),
      healthPath: z.literal(".secrets/rh-live/publisher-health.json"),
    })
    .strict()
    .safeParse(JSON.parse(raw));
  assert(parsed.success, "INVALID_PUBLISHER_POLICY");
  const policy = parsed.data;
  assert(
    policy.intervalMs / 1000 + policy.minimumFreshSeconds <
      Math.min(binding.stockMaxAgeSeconds, binding.debtMaxAgeSeconds),
    "PUBLISH_INTERVAL_EXCEEDS_SOURCE_LIFETIME",
  );
  return policy;
}
export async function publishReference(ctx, minimumFreshSeconds) {
  const { fetchTestnetReport } =
    await import("../../apps/price-oracle/src/services/testnetReference.ts");
  const { client, state, env, publisher } = ctx;
  assert(
    env.RH_REFERENCE_ORACLE_APPROVED === "true",
    "REFERENCE_ORACLE_APPROVAL_REQUIRED",
  );
  const binding = JSON.parse(env.RH_REFERENCE_BINDING_JSON);
  await verifyBinding(ctx, binding);
  assert(
    same(
      await verifyRuntime(client, state.oracle, "RhTestnetReferenceOracle"),
      state.oracleCodeHash,
    ),
    "ORACLE_RUNTIME_MISMATCH",
  );
  const abi = artifact("RhTestnetReferenceOracle").abi;
  const read = (functionName, args = []) =>
    client.readContract({ address: state.oracle, abi, functionName, args });
  assert(
    same(await read("publisher"), publisher.address) &&
      same(
        await read("bindingHash"),
        v.keccak256(v.toHex(JSON.stringify(binding))),
      ),
    "ORACLE_BINDING_MISMATCH",
  );
  const prices = await fetchTestnetReport(binding, {
    timeoutMs: Number(env.ORACLE_HTTP_TIMEOUT_MS),
    maxResponseBytes: Number(env.ORACLE_MAX_RESPONSE_BYTES),
    robinhoodTransport: parseRobinhoodTransport(env.ROBINHOOD_TRANSPORT_JSON),
    usdgTransport: parseReferenceTransport(env.USDG_TRANSPORT_JSON),
  });
  const block = await client.getBlock();
  assert(
    BigInt(
      prices.collateralTimestamp +
        binding.stockMaxAgeSeconds -
        minimumFreshSeconds,
    ) > block.timestamp &&
      BigInt(
        prices.debtTimestamp + binding.debtMaxAgeSeconds - minimumFreshSeconds,
      ) > block.timestamp,
    "SOURCE_NEAR_EXPIRY",
  );
  const oldStock = await read("observations", [binding.collateral]);
  const oldDebt = await read("observations", [binding.debt]);
  const id = `publish-${binding.stockSymbol}-${prices.collateralTimestamp}-${prices.debtTimestamp}`;
  let receipt;
  if (
    oldStock[1] !== BigInt(prices.collateralTimestamp) ||
    oldDebt[1] !== BigInt(prices.debtTimestamp)
  ) {
    save(
      `${ctx.directory}/reference-${binding.stockSymbol}-${prices.collateralTimestamp}-${prices.debtTimestamp}.json`,
      prices,
    );
    receipt = await submit(ctx, id, publisher, {
      to: state.oracle,
      data: v.encodeFunctionData({
        abi,
        functionName: "publish",
        args: [
          BigInt(prices.collateralPrice18),
          BigInt(prices.collateralTimestamp),
          BigInt(prices.debtPrice18),
          BigInt(prices.debtTimestamp),
          v.keccak256(v.toHex(json(prices))),
        ],
      }),
    });
  } else {
    assert(
      oldStock[0] === BigInt(prices.collateralPrice18) &&
        oldDebt[0] === BigInt(prices.debtPrice18),
      "CONFLICTING_SOURCE_REPORT",
    );
  }
  await Promise.all([
    read("getPrice", [binding.collateral]),
    read("getPrice", [binding.debt]),
  ]);
  return {
    id,
    receipt,
    stockTimestamp: prices.collateralTimestamp,
    debtTimestamp: prices.debtTimestamp,
  };
}
export function safeCode(error) {
  return typeof error?.message === "string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)
    ? error.message
    : "PUBLISHER_OPERATION_FAILED_REDACTED";
}
export function runBudgetAllows(
  policy,
  startedAt,
  publications,
  reservedGas,
  nextGas,
  now,
) {
  return (
    runBudgetStopReason(
      policy,
      startedAt,
      publications,
      reservedGas,
      nextGas,
      now,
    ) === null
  );
}
export function runBudgetStopReason(
  policy,
  startedAt,
  publications,
  reservedGas,
  nextGas,
  now,
) {
  if (now - startedAt >= policy.maxRunSeconds * 1000)
    return "DURATION_LIMIT_REACHED";
  if (publications >= policy.maxPublications)
    return "PUBLICATION_LIMIT_REACHED";
  if (reservedGas + nextGas > BigInt(policy.maxGasCostWei))
    return "SESSION_GAS_LIMIT_REACHED";
  return null;
}
