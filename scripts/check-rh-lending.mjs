import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { assert, v, json, safeFailure } from "./lib/rh-live.mjs";
import { readLendingSnapshot } from "../apps/web/src/lib/lending-client.ts";
import environment from "../apps/web/config/environment.cjs";
try {
  assert(
    process.argv.length === 3 && process.argv[2] === ".env.testnet",
    "EXPLICIT_TESTNET_PROFILE_REQUIRED",
  );
  const env = parseEnv(readFileSync(process.argv[2], "utf8"));
  const config = environment.validate(environment.clientSchema, env);
  assert(
    config.NETWORK_MODE === "TESTNET" &&
      config.CHAIN_ID === 46630 &&
      config.LENDING_DEPLOYMENT_JSON,
    "VERIFIED_TESTNET_DEPLOYMENT_REQUIRED",
  );
  const client = v.createPublicClient({
    transport: v.http(env.RPC_URL, {
      retryCount: 0,
      timeout: Number(env.RPC_TIMEOUT_MS),
    }),
    cacheTime: 0,
  });
  const snapshot = await readLendingSnapshot(
    client,
    config.LENDING_DEPLOYMENT_JSON,
    env.TESTER_ADDRESS,
  );
  const gas = await client.getBalance({ address: env.TESTER_ADDRESS });
  const policy = JSON.parse(env.RH_PUBLISHER_POLICY_JSON);
  const health = existsSync(policy.healthPath)
    ? JSON.parse(readFileSync(policy.healthPath, "utf8"))
    : null;
  let processAlive = false;
  if (health)
    try {
      process.kill(health.pid, 0);
      processAlive = true;
    } catch {}
  const heartbeatFresh =
    !!health &&
    Date.now() - Date.parse(health.updatedAt) <
      JSON.parse(env.RH_REFERENCE_BINDING_JSON).stockMaxAgeSeconds * 1000 &&
    Date.now() < Date.parse(health.expiresAt);
  const web = parseEnv(readFileSync("apps/web/.env", "utf8"));
  console.log(
    json({
      capturedAt: new Date().toISOString(),
      chainId: 46630,
      marketStatus: snapshot.status,
      oracleAvailable: snapshot.oracleAvailable,
      poolUsdg: v.formatUnits(snapshot.liquidity, 6),
      tester: {
        tsla: v.formatUnits(snapshot.collateralBalance, 18),
        usdg: v.formatUnits(snapshot.debtBalance, 6),
        gasEth: v.formatEther(gas),
        collateral: v.formatUnits(snapshot.collateral, 18),
        debt: v.formatUnits(snapshot.debt, 6),
      },
      publisher: {
        status: health?.status ?? "not-started",
        processAlive,
        heartbeatFresh,
        expiresAt: health?.expiresAt ?? null,
        publications: health?.publications ?? 0,
      },
      webGateConfigured: web.LENDING_ENABLED === "true",
      legacyTradingDisabled: web.TRADING_ENABLED === "false",
      readyForSupervisedBrowserTest:
        snapshot.status === 0 &&
        snapshot.oracleAvailable &&
        gas > 0n &&
        processAlive &&
        heartbeatFresh &&
        health?.status === "healthy" &&
        web.LENDING_ENABLED === "true",
      note: "Web ENV is configuration only; build/browser validation is required. This snapshot does not prove browser wallet signing.",
    }),
  );
} catch (error) {
  safeFailure(error);
}
