import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { parseMarketRows } from "../apps/web/src/lib/market-data.mjs";
const [path, output] = process.argv.slice(2);
try {
  if (!path || !output) throw new Error("Explicit ENV and output required");
  const config = parseEnv(readFileSync(path, "utf8"));
  assert.equal(config.TRADING_ENABLED, "false");
  assert.equal(config.NETWORK_MODE, "TESTNET");
  async function call(base, route, options) {
    const response = await fetch(new URL(route, base), {
      ...options,
      signal: AbortSignal.timeout(Number(config.RPC_TIMEOUT_MS)),
    });
    const text = await response.text();
    for (const key of [
      "RPC_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "KEEPER_PRIVATE_KEY",
      "PRIVATE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATABASE_URL",
    ])
      if (config[key] && config[key].length > 12)
        assert(!text.includes(config[key]));
    return { status: response.status, body: JSON.parse(text) };
  }
  const health = await call(config.BACKEND_API_URL, "/health");
  assert.equal(health.body.writesEnabled, false);
  assert.equal(health.body.testnetReady, false);
  const markets = await call(
    config.WEB_ORIGIN,
    "/api/v1/markets?network=TESTNET",
  );
  assert.equal(markets.status, 200);
  const rows = parseMarketRows(markets.body.data, "TESTNET");
  assert(rows.length > 0);
  const first = rows[0];
  const detail = await call(
    config.WEB_ORIGIN,
    `/api/v1/markets/${encodeURIComponent(first.slug)}?network=TESTNET`,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.network, "TESTNET");
  assert.equal(
    (await call(config.WEB_ORIGIN, "/api/v1/markets?network=MAINNET")).status,
    400,
  );
  assert.equal(
    (
      await call(config.WEB_ORIGIN, "/api/v1/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    ).status,
    503,
  );
  const rpc = await call(config.WEB_ORIGIN, "/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
  });
  assert.equal(rpc.status, 200);
  assert.equal(Number(BigInt(rpc.body.result)), Number(config.CHAIN_ID));
  const refused = await call(config.WEB_ORIGIN, "/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_sendRawTransaction",
      params: [],
    }),
  });
  assert.equal(refused.status, 400);
  mkdirSync(output, { recursive: true });
  writeFileSync(
    `${output}/local-api.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        network: "TESTNET",
        marketRowsValidated: rows.length,
        checks: {
          relativeGateway: true,
          marketDetailNetworkScoped: true,
          crossNetworkBlocked: true,
          unverifiedPositionWritesBlocked: true,
          rpcReadSuccessful: true,
          rpcSubmissionRejected: true,
          privateValuesExcluded: true,
        },
        health: health.body,
        transactionsSubmitted: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log("Live local API/RPC checks PASS; no transaction submitted");
} catch {
  console.error("Local API verification failed; details redacted");
  process.exitCode = 1;
}
