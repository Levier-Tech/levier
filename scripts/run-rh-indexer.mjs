import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { v, json } from "./lib/rh-live.mjs";
import {
  connectIndexerDatabase,
  indexerStore,
} from "./lib/rh-indexer-store.mjs";
import { syncIndexer, verifyIndexerIdentity } from "./lib/rh-indexer.mjs";
const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { z } = requireWeb("zod");
import { indexerScopes } from "./lib/rh-indexer-scope.mjs";
export const policySchema = z
  .object({
    confirmations: z.number().int().min(2).max(10000),
    batchBlocks: z.number().int().min(1).max(1000),
    maxBatches: z.number().int().min(1).max(100),
    pollIntervalMs: z.number().int().min(1000).max(60000),
  })
  .strict();
export async function main(args) {
  const [mode, profile] = args;
  if (
    args.length !== 2 ||
    !["--migrate", "--sync", "--serve", "--status"].includes(mode) ||
    (profile !== "--runtime" &&
      resolve(profile) !==
        fileURLToPath(new URL("../.env.testnet", import.meta.url)))
  )
    throw Error("EXPLICIT_TESTNET_PROFILE_REQUIRED");
  const env =
    profile === "--runtime"
      ? process.env
      : parseEnv(readFileSync(profile, "utf8"));
  // The file profile is the testnet one; --runtime may run on testnet or mainnet.
  const chainId = { TESTNET: 46630, MAINNET: 4663 }[env.NETWORK_MODE];
  if (
    !chainId ||
    env.CHAIN_ID !== String(chainId) ||
    (profile !== "--runtime" && chainId !== 46630) ||
    env.TRADING_ENABLED !== "false"
  )
    throw Error("INDEXER_NETWORK_MISMATCH");
  if (
    !env.INDEXER_MARKETS_JSON ||
    !env.INDEXER_RPC_URL ||
    !env.INDEXER_POLICY_JSON
  )
    throw Error("INDEXER_ENV_REQUIRED");
  const endpoint = new URL(env.INDEXER_RPC_URL);
  if (endpoint.protocol !== "https:") throw Error("INDEXER_RPC_HTTPS_REQUIRED");
  const policy = policySchema.parse(JSON.parse(env.INDEXER_POLICY_JSON));
  const entries = indexerScopes(env.INDEXER_MARKETS_JSON);
  if (policy.maxBatches < entries.length)
    throw Error("INDEXER_BATCH_BUDGET_TOO_SMALL");
  // maxBatches remains a global per-pass budget, not ten independent budgets.
  const pairPolicy = {
    ...policy,
    maxBatches: Math.floor(policy.maxBatches / entries.length),
  };
  const timeout = Number(env.RPC_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw Error("RPC_TIMEOUT_REQUIRED");
  const client = v.createPublicClient({
    transport: v.http(env.RPC_URL, { timeout, retryCount: 0 }),
    cacheTime: 0,
  });
  const logClient = v.createPublicClient({
    transport: v.http(env.INDEXER_RPC_URL, { timeout, retryCount: 0 }),
    cacheTime: 0,
  });
  const sql = connectIndexerDatabase({
    ...env,
    DATABASE_SSL_CA_PATH: env.DATABASE_SSL_CA_PATH
      ? resolve(
          profile === "--runtime" ? process.cwd() : dirname(profile),
          env.DATABASE_SSL_CA_PATH,
        )
      : undefined,
  });
  try {
    await sql`select 1`;
    if (mode === "--migrate") {
      for (const entry of entries)
        await verifyIndexerIdentity(
          client,
          entry.deployment,
          entry.scope.startBlock,
        );
      const migration = readFileSync(
        new URL(
          "../supabase/migrations/20260917000001_rh_canonical_lending.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('rh-canonical-lending-migration',0))`;
        await tx.unsafe(migration);
      });
      console.log(
        json({
          status: "RH lending tables prepared",
          chainId,
          arcTablesTouched: false,
        }),
      );
      return;
    }
    const targets = entries.map((entry) => ({
      ...entry,
      store: indexerStore(sql, entry.scope),
    }));
    if (mode === "--status") {
      const markets = [];
      for (const { symbol, side, scope, store } of targets) {
        const checkpoint = await store.checkpoint();
        const [counts] =
          await sql`select (select count(*) from public.rh_lending_events where chain_id=${scope.chainId} and pair_address=${scope.pair}) as events,(select count(*) from public.rh_lending_accounts where chain_id=${scope.chainId} and pair_address=${scope.pair}) as accounts`;
        markets.push({ symbol, side, checkpoint, counts });
      }
      console.log(json({ capturedAt: new Date().toISOString(), markets }));
      return;
    }
    for (const target of targets) await target.store.lock();
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      do {
        const markets = [];
        for (const target of targets) {
          if (controller.signal.aborted) break;
          const report = await syncIndexer({
            client,
            logClient,
            deployment: target.deployment,
            store: target.store,
            policy: pairPolicy,
            scope: target.scope,
            signal: controller.signal,
          });
          markets.push({ symbol: target.symbol, side: target.side, ...report });
        }
        const report = {
          capturedAt: new Date().toISOString(),
          markets,
          configuredPairs: targets.length,
          caughtUp:
            markets.length === targets.length &&
            markets.every((m) => m.caughtUp),
        };
        mkdirSync(
          new URL("../docs/evidence/rh-canonical-indexer/", import.meta.url),
          { recursive: true },
        );
        writeFileSync(
          new URL(
            "../docs/evidence/rh-canonical-indexer/latest.json",
            import.meta.url,
          ),
          json(report) + "\n",
        );
        console.log(json(report));
        if (mode !== "--serve" || controller.signal.aborted) break;
        await new Promise((resolve) => {
          const timer = setTimeout(done, policy.pollIntervalMs);
          function done() {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          }
          controller.signal.addEventListener("abort", done, { once: true });
        });
      } while (!controller.signal.aborted);
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      "RH indexer stopped: configuration, RPC or database verification failed. No provider details are logged; reconcile the checkpoint before retrying.",
    );
    process.exitCode = 1;
  });
