import test from "node:test";
import assert from "node:assert/strict";
import {
  decimal18,
  validateReference,
  tokenValuation,
  fetchJson,
} from "../src/services/robinhoodQuoteService.js";
import { loadOracleConfig } from "../src/config.js";
import { PriceOracleWorker } from "../src/worker.js";
const now = Date.parse("2026-09-17T03:00:00Z");
const address = "0x" + "12".repeat(20);
const identity = { symbol: "TSLA", chainId: 46630, address };
const policy = { maxAgeMs: 60000, maxFutureSkewMs: 1000, maxSpreadBps: 100 };
function data() {
  const deployments = [{ contractAddress: address, chainId: 46630 }];
  return {
    assets: {
      assets: [
        {
          tokenSymbol: "TSLA",
          currentMultiplier: "1.25",
          pendingMultiplier: "",
          status: "ASSET_STATUS_ACTIVE",
          deployments,
        },
      ],
    },
    quotes: {
      quotes: [
        {
          tokenSymbol: "TSLA",
          bid: "100.000000000000000001",
          ask: "100.1",
          currency: "USD",
          isTradingHalt: false,
          generatedAt: new Date(now - 1000).toISOString(),
          deployments,
        },
      ],
    },
  };
}
function reference(d = data()) {
  return validateReference(d.assets, d.quotes, identity, policy, now);
}
test("exact decimal normalization and conservative multiplier rounding", () => {
  assert.equal(decimal18("0.000000000000000001"), 1n);
  assert.deepEqual(tokenValuation(reference(), policy, now), {
    bid18: "125000000000000000001",
    ask18: "125125000000000000000",
    generatedAt: new Date(now - 1000).toISOString(),
  });
  for (const value of [
    "0",
    "-1",
    "1e3",
    "Infinity",
    "1.0000000000000000001",
    "1" + "0".repeat(80),
  ])
    assert.throws(() => decimal18(value));
});
test("fresh underlying quote cannot price an unrelated chain/token", () => {
  const d = data();
  d.assets.assets[0].deployments[0].chainId = 4663;
  const ref = reference(d);
  assert.equal(ref.assetDeploymentMatches, false);
  assert.throws(
    () => tokenValuation(ref, policy, now),
    /TOKEN_DEPLOYMENT_UNVERIFIED/,
  );
  const other = data();
  other.quotes.quotes[0].deployments = [
    { chainId: 46630, contractAddress: "0x" + "34".repeat(20) },
  ];
  assert.throws(
    () => tokenValuation(reference(other), policy, now),
    /TOKEN_DEPLOYMENT_UNVERIFIED/,
  );
});
test("stale, future and cached-expired quotes are rejected", () => {
  const d = data();
  d.quotes.quotes[0].generatedAt = new Date(now - 60001).toISOString();
  assert.throws(() => reference(d), /STALE_QUOTE/);
  d.quotes.quotes[0].generatedAt = new Date(now + 1001).toISOString();
  assert.throws(() => reference(d), /FUTURE_QUOTE/);
  assert.throws(
    () => tokenValuation(reference(), policy, now + 60000),
    /QUOTE_EXPIRED/,
  );
});
test("halt and pending corporate action never produce a valuation", () => {
  const d = data();
  d.quotes.quotes[0].isTradingHalt = true;
  assert.throws(() => reference(d), /TRADING_HALTED/);
  d.quotes.quotes[0].isTradingHalt = false;
  d.assets.assets[0].pendingMultiplier = "2";
  assert.throws(() => reference(d), /CORPORATE_ACTION_PENDING/);
});
test("missing and ambiguous symbol/currency/metadata fail closed", () => {
  const d = data();
  d.quotes.quotes[0].tokenSymbol = "USDG";
  assert.throws(() => reference(d), /AMBIGUOUS_OR_MISSING_SYMBOL/);
  const duplicate = data();
  duplicate.assets.assets.push(duplicate.assets.assets[0]);
  assert.throws(() => reference(duplicate), /AMBIGUOUS_OR_MISSING_SYMBOL/);
  const invalid = data();
  invalid.quotes.quotes[0].currency = "EUR";
  assert.throws(() => reference(invalid), /INVALID_RESPONSE/);
  const inactive = data();
  inactive.assets.assets[0].status = "ASSET_STATUS_INACTIVE";
  assert.throws(() => reference(inactive), /ASSET_INACTIVE/);
});
test("crossed or excessive spread cannot be published", () => {
  const d = data();
  d.quotes.quotes[0].ask = "99";
  assert.throws(() => reference(d), /CROSSED_QUOTE/);
  d.quotes.quotes[0].ask = "110";
  assert.throws(() => reference(d), /SPREAD_TOO_WIDE/);
});
test("bounded HTTP reader rejects large payload and sanitizes upstream errors", async () => {
  const url = new URL("https://fixture.invalid/");
  const oversized = (async () => new Response("x".repeat(200))) as typeof fetch;
  await assert.rejects(
    fetchJson(url, { timeoutMs: 100, maxResponseBytes: 10 }, oversized),
    /RESPONSE_TOO_LARGE/,
  );
  const rejected = (async () => {
    throw Error("sensitive-upstream-value");
  }) as typeof fetch;
  await assert.rejects(
    fetchJson(url, { timeoutMs: 100, maxResponseBytes: 10 }, rejected),
    (error) =>
      error instanceof Error && error.message === "UPSTREAM_UNAVAILABLE",
  );
});
function environment(): NodeJS.ProcessEnv {
  return {
    NETWORK_MODE: "TESTNET",
    CHAIN_ID: "46630",
    TRADING_ENABLED: "false",
    ORACLE_WORKER_MODE: "DISABLED",
    ROBINHOOD_TRANSPORT_JSON: JSON.stringify({mode:"SYSTEM"}),
    ROBINHOOD_STOCK_API_URL: "https://fixture.invalid/rhj/",
    ORACLE_POLL_INTERVAL_MS: "15000",
    ORACLE_HTTP_TIMEOUT_MS: "100",
    ORACLE_MAX_RESPONSE_BYTES: "10000",
    ORACLE_MAX_QUOTE_AGE_MS: "60000",
    ORACLE_MAX_FUTURE_SKEW_MS: "1000",
    ORACLE_MAX_SPREAD_BPS: "100",
    ORACLE_SYMBOLS_JSON: '["TSLA"]',
    PROTOCOL_ADDRESSES: JSON.stringify({ tokens: { TSLA: address } }),
  };
}
test("network, write gate, missing policy and missing token have no fallback", () => {
  for (const [key, value] of [
    ["NETWORK_MODE", "MAINNET"],
    ["CHAIN_ID", "4663"],
    ["TRADING_ENABLED", "true"],
    ["ORACLE_MAX_QUOTE_AGE_MS", ""],
    ["ORACLE_MAX_FUTURE_SKEW_MS", ""],
    ["ORACLE_SYMBOLS_JSON", '["USDG"]'],
  ]) {
    const env = environment();
    env[key] = value;
    assert.throws(() => loadOracleConfig(env), /Invalid oracle ENV fields/);
  }
});
test("disabled worker does not fetch or touch database", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw Error();
  }) as typeof fetch;
  try {
    await new PriceOracleWorker(loadOracleConfig(environment())).start();
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});
