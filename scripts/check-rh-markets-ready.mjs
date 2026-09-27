import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { assert, v, json, save, safeFailure } from "./lib/rh-live.mjs";
import {
  readMarginSnapshot,
  marginOrder,
} from "../apps/web/src/lib/margin-client.ts";
import environment from "../apps/web/config/environment.cjs";
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  const env = parseEnv(readFileSync(process.argv[2], "utf8"));
  const config = environment.validate(environment.clientSchema, env);
  const web = environment.validate(
    environment.clientSchema,
    parseEnv(readFileSync("apps/web/.env", "utf8")),
  );
  assert(
    config.NETWORK_MODE === "TESTNET" && config.CHAIN_ID === 46630,
    "TESTNET_ONLY",
  );
  const client = v.createPublicClient({
    transport: v.http(env.RPC_URL, {
      retryCount: 0,
      timeout: Number(env.RPC_TIMEOUT_MS),
    }),
    cacheTime: 0,
  });
  const markets = [];
  for (const row of config.MARKET_DEPLOYMENTS_JSON) {
    const s = await readMarginSnapshot(
      client,
      row.margin,
      row.long,
      env.TESTER_ADDRESS,
    );
    const options = [];
    for (const short of [false, true])
      for (const bps of short
        ? row.margin.policy.shortExposureBps
        : row.margin.policy.longLeveragesBps) {
        let available = false;
        try {
          marginOrder(
            row.margin,
            row.long,
            s,
            short,
            v.formatUnits(BigInt(row.margin.policy.maxMarginRaw), 6),
            bps,
          );
          available = true;
        } catch {}
        options.push({
          side: short ? "short" : "long",
          multipleBps: bps,
          available,
        });
      }
    markets.push({
      symbol: row.symbol,
      configured: web.MARKET_DEPLOYMENTS_JSON.some(
        (x) =>
          x.symbol === row.symbol &&
          x.enabled &&
          x.margin.router === row.margin.router,
      ),
      block: String(s.blockNumber),
      routerPaused: s.paused,
      longStatus: s.longPosition.status,
      shortStatus: s.shortPosition.status,
      oracleAvailable:
        s.longPosition.oracleAvailable && s.shortPosition.oracleAvailable,
      longLiquidityUsdg: v.formatUnits(s.longPosition.liquidity, 6),
      shortLiquidityStock: v.formatUnits(s.shortPosition.liquidity, 18),
      testerUsdg: v.formatUnits(s.longPosition.debtBalance, 6),
      options,
      ready:
        s.paused === false &&
        s.longPosition.status === 0 &&
        s.shortPosition.status === 0 &&
        options.every((x) => x.available),
    });
  }
  const policy = JSON.parse(env.RH_PUBLISHER_POLICY_JSON),
    health = existsSync(policy.healthPath)
      ? JSON.parse(readFileSync(policy.healthPath, "utf8"))
      : null;
  let alive = false;
  if (health)
    try {
      process.kill(health.pid, 0);
      alive = true;
    } catch {}
  const fresh =
    health &&
    Date.now() - Date.parse(health.updatedAt) <
      JSON.parse(env.RH_REFERENCE_BINDING_JSON).stockMaxAgeSeconds * 1000 &&
    Date.now() < Date.parse(health.expiresAt);
  const gas = await client.getBalance({ address: env.TESTER_ADDRESS });
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: 46630,
    markets,
    testerGasEth: v.formatEther(gas),
    publisher: {
      status: health?.status ?? "not-started",
      processAlive: alive,
      heartbeatFresh: !!fresh,
      publications: health?.publications ?? 0,
      expiresAt: health?.expiresAt ?? null,
    },
    readyForSupervisedBrowserTest:
      markets.length === 5 &&
      markets.every((x) => x.configured && x.ready) &&
      alive &&
      !!fresh &&
      health.status === "healthy" &&
      gas > 0n &&
      web.MARGIN_TRADING_ENABLED === true,
    note: "Read-only observations and quotes, not browser signing acceptance or a guarantee of later availability. Max margin is 1 USDG only if configured that way in ENV; liquidity and oracle freshness remain mandatory.",
  };
  save("docs/evidence/rh-expansion-live/readiness.json", report);
  console.log(json(report));
} catch (error) {
  safeFailure(error);
}
