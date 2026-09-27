import { readFileSync, statSync } from "node:fs";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import {
  context,
  assert,
  same,
  updateEnv,
  save,
  safeFailure,
} from "./lib/rh-live.mjs";
import { acquireLock } from "./lib/process-lock.mjs";
import { readMarginSnapshot } from "../apps/web/src/lib/margin-client.ts";
import configuration from "../apps/web/config/market-deployments.cjs";
import environment from "../apps/web/config/environment.cjs";

let release;
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  release = acquireLock(".secrets/rh-live/operations.lock");
  const ctx = await context(process.argv[2]);
  const symbols = ["AMZN", "PLTR", "NFLX", "AMD"];
  const receipts = [];
  for (const symbol of symbols) {
    const entry = ctx.state.expansion?.[symbol];
    assert(
      entry?.deploymentComplete &&
        entry.liveAcceptancePassed &&
        entry.acceptance?.complete,
      "REAL_MARKET_ACCEPTANCE_REQUIRED",
    );
    assert(
      entry.scopeHash === ctx.env.RH_EXPANSION_APPROVED_SCOPE_HASH,
      "APPROVED_SCOPE_MISMATCH",
    );
    const { long, margin } = entry.descriptor;
    const expected = [
      ...margin.policy.longLeveragesBps.map((x) => `long-${x}`),
      ...margin.policy.shortExposureBps.map((x) => `short-${x}`),
    ];
    assert(
      entry.acceptance.direct.complete &&
        expected.every((k) => entry.acceptance.sides[k]?.complete),
      "ALL_OFFERED_OPTIONS_MUST_PASS",
    );
    const d = entry.acceptance.direct.result;
    const hashes = [
      d.depositHash,
      d.borrowHash,
      d.repayHash,
      d.withdrawHash,
      ...expected.flatMap((k) => {
        const r = entry.acceptance.sides[k].result;
        return [r.openHash, r.closeHash];
      }),
    ];
    for (const hash of hashes) {
      const r = await ctx.client.getTransactionReceipt({ hash });
      assert(
        r.status === "success" &&
          same(r.from, ctx.deployer.address) &&
          (await ctx.client.getBlock({ blockNumber: r.blockNumber })).hash ===
            r.blockHash,
        "ACCEPTANCE_RECEIPT_NOT_CANONICAL",
      );
    }
    const snapshot = await readMarginSnapshot(
      ctx.client,
      margin,
      long,
      ctx.deployer.address,
    );
    assert(
      snapshot.paused &&
        [snapshot.longPosition, snapshot.shortPosition].every(
          (p) =>
            p.status === 2 &&
            p.collateral === 0n &&
            p.debt === 0n &&
            p.liquidity > 0n,
        ) &&
        snapshot.reserves.every((x) => x > 0n),
      "RELEASE_REQUIRES_CLEAN_FUNDED_PAUSED_MARKET",
    );
    receipts.push({
      symbol,
      receiptCount: hashes.length,
      router: margin.router,
      longPair: long.pair,
      shortPair: margin.short.pair,
    });
  }
  const profiles = [".env.testnet", ".env", "apps/web/.env"].map((path) => {
    execFileSync("git", ["check-ignore", "-q", path]);
    assert(
      !execFileSync("git", ["ls-files", "--", path], {
        encoding: "utf8",
      }).trim() && (statSync(path).mode & 0o077) === 0,
      "PRIVATE_PROFILE_REQUIRED",
    );
    const content = readFileSync(path, "utf8"),
      env = parseEnv(content);
    assert(
      env.NETWORK_MODE === "TESTNET" &&
        env.CHAIN_ID === "46630" &&
        env.TRADING_ENABLED === "false" &&
        env.MARGIN_TRADING_ENABLED ===
          (path === ".env.testnet" ? "false" : "true"),
      "TESTNET_GATES_REQUIRED",
    );
    const rows = configuration.marketDeploymentsSchema.parse(
      JSON.parse(env.MARKET_DEPLOYMENTS_JSON),
    );
    const protocol = JSON.parse(env.PROTOCOL_ADDRESSES);
    for (const symbol of symbols) {
      const row = rows.find((x) => x.symbol === symbol),
        expected = ctx.state.expansion[symbol].descriptor;
      assert(
        row &&
          isDeepStrictEqual(row.long, expected.long) &&
          isDeepStrictEqual(row.margin, expected.margin),
        "PROFILE_DESCRIPTOR_MISMATCH",
      );
      // The deployment profile stays non-executable for unrelated workers.
      row.enabled = path !== ".env.testnet";
      assert(
        same(protocol.tokens[symbol], row.long.collateral) &&
          same(protocol.registry, row.long.registry),
        "PROTOCOL_IDENTITY_MISMATCH",
      );
      protocol.pairs[symbol] = row.long.pair;
    }
    environment.validate(environment.clientSchema, {
      ...env,
      PROTOCOL_ADDRESSES: JSON.stringify(protocol),
      MARKET_DEPLOYMENTS_JSON: JSON.stringify(rows),
    });
    return {
      path,
      content,
      rows: configuration.marketDeploymentsSchema.parse(rows),
      protocol,
    };
  });
  for (const p of profiles)
    assert(readFileSync(p.path, "utf8") === p.content, "CONCURRENT_ENV_CHANGE");
  for (const p of profiles)
    updateEnv(p.path, {
      MARKET_DEPLOYMENTS_JSON: JSON.stringify(p.rows),
      PROTOCOL_ADDRESSES: JSON.stringify(p.protocol),
    });
  for (const symbol of symbols)
    ctx.state.expansion[symbol].applicationEnabled = true;
  ctx.persist();
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    markets: receipts,
    applicationConfigured: true,
    contractsState: "PAUSED_PENDING_PUBLISHER",
    transactionsSubmitted: 0,
    note: "Build/restart the web application and run the bounded publisher before supervised wallet tests. Configuration is not ongoing oracle readiness or browser signing acceptance.",
  };
  save("docs/evidence/rh-expansion-live/application-release.json", report);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  safeFailure(error);
} finally {
  release?.();
}
