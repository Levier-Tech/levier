import { chargedGasCost } from "./lib/rh-gas-ledger.mjs";
import { parseReferenceTransport } from "../apps/price-oracle/src/services/referenceTransport.ts";
import { parseRobinhoodTransport } from "../apps/price-oracle/src/services/robinhoodTransport.ts";
import { acquireLock } from "./lib/process-lock.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import {
  context,
  artifact,
  assert,
  same,
  save,
  submit,
  safeFailure,
  v,
} from "./lib/rh-live.mjs";
import {
  publisherPolicy,
  publishReference,
  marketReferenceContext,
  safeCode,
  runBudgetAllows,
  runBudgetStopReason,
} from "./lib/rh-publisher.mjs";
import { readMarginSnapshot } from "../apps/web/src/lib/margin-client.ts";
import { readLendingSnapshot } from "../apps/web/src/lib/lending-client.ts";

let ctx,
  policy,
  runId,
  release,
  stopped = false,
  stopReason = null,
  wake,
  managed = [],
  references = [],
  managedRouters = [];
const startedAt = Date.now();
let publications = 0,
  failures = 0,
  activationAttempted = false;
function stop(signal) {
  stopped = true;
  stopReason ??= signal;
  wake?.abort();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
const health = (status, extra = {}) => {
  save(policy.healthPath, {
    version: 1,
    chainId: 46630,
    runId,
    pid: process.pid,
    status,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(startedAt + policy.maxRunSeconds * 1000).toISOString(),
    publications,
    failures,
    stopReason,
    ...extra,
  });
  // Only explicit operational fields reach stdout; never serialize ENV/provider errors.
  console.log(
    JSON.stringify({
      status,
      mode: process.argv[2] === "--serve" ? "serve" : "observe",
      pid: process.pid,
      runId,
      publications,
      stopReason,
      symbols: references.map((target) => target.symbol),
      ...(extra.code ? { code: extra.code } : {}),
    }),
  );
};
async function setStatus(status, operation) {
  console.log(
    JSON.stringify({
      stage: operation,
      pairs: managed.length,
      routers: managedRouters.length,
    }),
  );
  const abi = artifact("LevierMarketRegistry").abi;
  async function setRouters() {
    const routerAbi = artifact("MarginRouter").abi;
    for (const d of managedRouters) {
      const paused = await ctx.client.readContract({
        address: d.router,
        abi: routerAbi,
        functionName: "isPaused",
      });
      if (paused === (status === 2)) continue;
      await submit(
        ctx,
        `${runId}-${operation}-router-${d.router}`,
        ctx.deployer,
        {
          to: d.router,
          data: v.encodeFunctionData({
            abi: routerAbi,
            functionName: "setPaused",
            args: [status === 2],
          }),
        },
      );
    }
  }
  if (status === 2) await setRouters();
  for (const d of managed) {
    const market = await ctx.client.readContract({
      address: d.registry,
      abi,
      functionName: "getMarket",
      args: [d.marketId],
    });
    if (market.status === status) continue;
    await submit(ctx, `${runId}-${operation}-${d.marketId}`, ctx.deployer, {
      to: d.registry,
      data: v.encodeFunctionData({
        abi,
        functionName: "setMarketStatus",
        args: [d.marketId, status],
      }),
    });
    const updated = await ctx.client.readContract({
      address: d.registry,
      abi,
      functionName: "getMarket",
      args: [d.marketId],
    });
    assert(updated.status === status, "MARKET_STATUS_NOT_CONFIRMED");
  }
  if (status === 0) await setRouters();
}
try {
  assert(
    process.argv.length === 4 &&
      ["--observe", "--serve"].includes(process.argv[2]),
    "EXPLICIT_PUBLISHER_MODE_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  console.log(
    JSON.stringify({
      stage: "checking-testnet-configuration",
      mode: process.argv[2].slice(2),
    }),
  );
  ctx = await context(process.argv[3]);
  assert(
    ctx.state.acceptanceComplete && ctx.state.descriptor,
    "COMPLETED_LENDING_DEPLOYMENT_REQUIRED",
  );
  managed = [ctx.state.descriptor];
  references = [{ symbol: "TSLA", context: ctx }];
  if (ctx.env.MARGIN_DEPLOYMENT_JSON !== "") {
    console.log(JSON.stringify({ stage: "checking-market", symbol: "TSLA" }));
    const margin = JSON.parse(ctx.env.MARGIN_DEPLOYMENT_JSON);
    await readMarginSnapshot(
      ctx.client,
      margin,
      ctx.state.descriptor,
      ctx.env.TESTER_ADDRESS,
    );
    managed.push(margin.short);
    managedRouters.push(margin);
  }
  for (const [symbol, entry] of Object.entries(ctx.state.expansion ?? {})) {
    if (!entry.liveAcceptancePassed) continue;
    assert(
      entry.acceptance?.complete && entry.descriptor,
      "MARKET_ACCEPTANCE_INCOMPLETE",
    );
    const reference = marketReferenceContext(ctx, symbol);
    console.log(JSON.stringify({ stage: "checking-market", symbol }));
    await readMarginSnapshot(
      ctx.client,
      entry.descriptor.margin,
      entry.descriptor.long,
      ctx.env.TESTER_ADDRESS,
    );
    references.push({ symbol, context: reference });
    managed.push(entry.descriptor.long, entry.descriptor.margin.short);
    managedRouters.push(entry.descriptor.margin);
  }
  const binding = JSON.parse(ctx.env.RH_REFERENCE_BINDING_JSON);
  policy = publisherPolicy(ctx.env.RH_PUBLISHER_POLICY_JSON, binding);
  for (const target of references)
    publisherPolicy(
      ctx.env.RH_PUBLISHER_POLICY_JSON,
      JSON.parse(target.context.env.RH_REFERENCE_BINDING_JSON),
    );
  runId = `publisher-${randomUUID()}`;
  const serve = process.argv[2] === "--serve";
  const execution = JSON.parse(ctx.env.RH_LIVE_EXECUTION_JSON);
  assert(
    BigInt(policy.maxTransactionGasCostWei) <=
      BigInt(execution.maxTransactionGasCostWei),
    "PUBLISHER_MAY_NOT_INCREASE_TRANSACTION_BUDGET",
  );
  execution.maxTransactionGasCostWei = policy.maxTransactionGasCostWei;
  ctx.env.RH_LIVE_EXECUTION_JSON = JSON.stringify(execution);
  for (const target of references)
    target.context.env.RH_LIVE_EXECUTION_JSON = ctx.env.RH_LIVE_EXECUTION_JSON;
  assert(
    !Object.values(ctx.state.operations).some(
      (op) =>
        !op.receipt ||
        (op.receipt.status !== "success" && !op.failureReconciled),
    ),
    "UNRESOLVED_TRANSACTION_RECONCILIATION_REQUIRED",
  );
  const initialIds = new Set(Object.keys(ctx.state.operations));
  const reserved = () =>
    Object.entries(ctx.state.operations)
      .filter(
        ([id, op]) =>
          !initialIds.has(id) && same(op.from, ctx.publisher.address),
      )
      .reduce((sum, [, op]) => sum + chargedGasCost(op), 0n);
  // Leave owner gas and signer budget available for the closing pause transaction.
  const ownerReserved = Object.values(ctx.state.operations)
    .filter((op) => same(op.from, ctx.deployer.address))
    .reduce((sum, op) => sum + chargedGasCost(op), 0n);
  assert(
    ownerReserved +
      2n *
        BigInt(managed.length + managedRouters.length) *
        BigInt(execution.maxTransactionGasCostWei) <=
      BigInt(execution.maxSignerGasCostWei),
    "OWNER_PAUSE_BUDGET_REQUIRED",
  );
  assert(
    (await ctx.client.getBalance({ address: ctx.deployer.address })) >
      2n *
        BigInt(managed.length + managedRouters.length) *
        BigInt(execution.maxTransactionGasCostWei) +
        BigInt(execution.minimumGasReserveWei),
    "OWNER_PAUSE_GAS_REQUIRED",
  );
  const snapshot = await readLendingSnapshot(
    ctx.client,
    ctx.state.descriptor,
    ctx.env.TESTER_ADDRESS,
  );
  for (const d of managed) {
    const check =
      d === ctx.state.descriptor
        ? snapshot
        : await readLendingSnapshot(ctx.client, d, ctx.env.TESTER_ADDRESS);
    assert(check.status === 2, "START_REQUIRES_PAUSED_MARKET");
    assert(check.liquidity > 0n, "POOL_LIQUIDITY_REQUIRED");
  }
  assert(snapshot.liquidity > 0n, "POOL_LIQUIDITY_REQUIRED");
  const testerGas = await ctx.client.getBalance({
    address: ctx.env.TESTER_ADDRESS,
  });
  assert(testerGas > 0n, "TESTER_GAS_REQUIRED");
  health("starting", {
    symbols: references.map((x) => x.symbol),
    testerFunded: snapshot.collateralBalance > 0n && snapshot.debtBalance > 0n,
    testerGasPositive: true,
  });
  while (
    !stopped &&
    runBudgetAllows(
      policy,
      startedAt,
      publications,
      reserved(),
      BigInt(execution.maxTransactionGasCostWei),
      Date.now(),
    )
  ) {
    try {
      if (!serve) {
        console.log(
          JSON.stringify({
            stage: "checking-price-sources",
            symbols: references.map((target) => target.symbol),
          }),
        );
        // The observer never publishes or changes market status.
        const { fetchTestnetReport } =
          await import("../apps/price-oracle/src/services/testnetReference.ts");
        const reports = await Promise.all(
          references.map(async (target) => {
            const report = await fetchTestnetReport(
              JSON.parse(target.context.env.RH_REFERENCE_BINDING_JSON),
              {
                timeoutMs: Number(ctx.env.ORACLE_HTTP_TIMEOUT_MS),
                maxResponseBytes: Number(ctx.env.ORACLE_MAX_RESPONSE_BYTES),
                robinhoodTransport: parseRobinhoodTransport(
                  ctx.env.ROBINHOOD_TRANSPORT_JSON,
                ),
                usdgTransport: parseReferenceTransport(
                  ctx.env.USDG_TRANSPORT_JSON,
                ),
              },
            );
            return {
              symbol: target.symbol,
              stockTimestamp: report.collateralTimestamp,
              debtTimestamp: report.debtTimestamp,
            };
          }),
        );
        stopReason = "OBSERVATION_COMPLETE";
        health("source-valid-observation-only", {
          markets: reports,
        });
        break;
      }
      const reports = [];
      for (const target of references) {
        console.log(
          JSON.stringify({ stage: "refreshing-oracle", symbol: target.symbol }),
        );
        assert(
          runBudgetAllows(
            policy,
            startedAt,
            publications,
            reserved(),
            BigInt(execution.maxTransactionGasCostWei),
            Date.now(),
          ),
          "PUBLISHER_BATCH_BUDGET_EXHAUSTED",
        );
        const report = await publishReference(
          target.context,
          policy.minimumFreshSeconds,
        );
        if (report.receipt) publications++;
        reports.push({
          symbol: target.symbol,
          stockTimestamp: report.stockTimestamp,
          debtTimestamp: report.debtTimestamp,
        });
      }
      // Earlier publications must still be usable after the complete refresh cycle.
      await Promise.all(
        references.flatMap((target) => {
          const refBinding = JSON.parse(
            target.context.env.RH_REFERENCE_BINDING_JSON,
          );
          return [refBinding.collateral, refBinding.debt].map((asset) =>
            ctx.client.readContract({
              address: target.context.state.oracle,
              abi: artifact("RhTestnetReferenceOracle").abi,
              functionName: "getPrice",
              args: [asset],
            }),
          );
        }),
      );
      if (!activationAttempted) {
        assert(!stopped, "STOP_REQUESTED");
        activationAttempted = true;
        await setStatus(0, "activate");
        // Activation can span many receipts. Refresh again before reporting healthy.
        // The next cycle runs immediately; stale oracle checks still block borrowing.
        continue;
      }
      failures = 0;
      health("healthy", {
        stockTimestamp: reports[0].stockTimestamp,
        debtTimestamp: reports[0].debtTimestamp,
        markets: reports,
        reservedGasWei: String(reserved()),
      });
    } catch (error) {
      failures++;
      health("degraded", { code: safeCode(error) });
      // Any recorded send without a successful receipt is ambiguous: never sign a new update.
      const unresolved = Object.values(ctx.state.operations).some(
        (op) =>
          !op.receipt ||
          (op.receipt.status !== "success" && !op.failureReconciled),
      );
      if (
        unresolved ||
        activationAttempted ||
        failures >= policy.maxConsecutiveFailures
      )
        throw error;
    }
    wake = new AbortController();
    if (!stopped)
      await delay(policy.intervalMs, undefined, { signal: wake.signal }).catch(
        () => {},
      );
  }
  stopReason ??= runBudgetStopReason(
    policy,
    startedAt,
    publications,
    reserved(),
    BigInt(execution.maxTransactionGasCostWei),
    Date.now(),
  );
} catch (error) {
  stopReason ??= safeCode(error);
  if (ctx && policy) health("failed", { code: safeCode(error) });
  safeFailure(error);
} finally {
  if (activationAttempted) {
    try {
      health("stopping");
      // Reconcile uncertain activation before declaring that the market is paused.
      for (const d of managedRouters) {
        const id = `${runId}-activate-router-${d.router}`;
        if (ctx.state.operations[id] && !ctx.state.operations[id].receipt)
          await submit(ctx, id, ctx.deployer, {
            to: d.router,
            data: v.encodeFunctionData({
              abi: artifact("MarginRouter").abi,
              functionName: "setPaused",
              args: [false],
            }),
          });
      }
      for (const d of managed) {
        const id = `${runId}-activate-${d.marketId}`;
        const activation = ctx.state.operations[id];
        if (activation && !activation.receipt)
          await submit(ctx, id, ctx.deployer, {
            to: d.registry,
            data: v.encodeFunctionData({
              abi: artifact("LevierMarketRegistry").abi,
              functionName: "setMarketStatus",
              args: [d.marketId, 0],
            }),
          });
      }
      await setStatus(2, "pause");
      health("stopped-paused");
      console.log("PUBLISHER_STOPPED_MARKET_PAUSED");
    } catch (error) {
      if (ctx && policy) health("pause-unconfirmed", { code: safeCode(error) });
      safeFailure(error);
    }
  } else if (ctx && policy && process.argv[2] === "--serve")
    health("stopped-without-activation");
  release?.();
}
