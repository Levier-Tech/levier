import { randomUUID } from "node:crypto";
import {
  context,
  assert,
  artifact,
  submit,
  v,
  safeFailure,
} from "./lib/rh-live.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import { readMarginSnapshot } from "../apps/web/src/lib/margin-client.ts";
let release;
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  const ctx = await context(process.argv[2]),
    runId = `pause-${randomUUID()}`;
  assert(
    !Object.values(ctx.state.operations).some(
      (x) =>
        !x.receipt || (x.receipt.status !== "success" && !x.failureReconciled),
    ),
    "UNRESOLVED_TRANSACTION_RECONCILIATION_REQUIRED",
  );
  const entries = [
    {
      symbol: "TSLA",
      long: ctx.state.descriptor,
      margin: JSON.parse(ctx.env.MARGIN_DEPLOYMENT_JSON),
    },
    ...Object.entries(ctx.state.expansion ?? {})
      .filter(([, x]) => x.deploymentComplete)
      .map(([symbol, x]) => ({ symbol, ...x.descriptor })),
  ];
  for (const e of entries)
    await readMarginSnapshot(
      ctx.client,
      e.margin,
      e.long,
      ctx.deployer.address,
    );
  for (const e of entries) {
    const router = artifact("MarginRouter").abi,
      registry = artifact("LevierMarketRegistry").abi;
    if (
      !(await ctx.client.readContract({
        address: e.margin.router,
        abi: router,
        functionName: "isPaused",
      }))
    )
      await submit(ctx, `${runId}-${e.symbol}-router`, ctx.deployer, {
        to: e.margin.router,
        data: v.encodeFunctionData({
          abi: router,
          functionName: "setPaused",
          args: [true],
        }),
      });
    for (const [side, d] of [
      ["long", e.long],
      ["short", e.margin.short],
    ]) {
      const m = await ctx.client.readContract({
        address: d.registry,
        abi: registry,
        functionName: "getMarket",
        args: [d.marketId],
      });
      if (m.status !== 2)
        await submit(ctx, `${runId}-${e.symbol}-${side}`, ctx.deployer, {
          to: d.registry,
          data: v.encodeFunctionData({
            abi: registry,
            functionName: "setMarketStatus",
            args: [d.marketId, 2],
          }),
        });
    }
    const verified = await readMarginSnapshot(
      ctx.client,
      e.margin,
      e.long,
      ctx.deployer.address,
    );
    assert(
      verified.paused &&
        verified.longPosition.status === 2 &&
        verified.shortPosition.status === 2,
      "PAUSE_NOT_CONFIRMED",
    );
    console.log(
      JSON.stringify({ symbol: e.symbol, status: "PAUSED_CONFIRMED" }),
    );
  }
} catch (error) {
  safeFailure(error);
} finally {
  release?.();
}
