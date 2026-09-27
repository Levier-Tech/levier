import lendingConfig from "../apps/web/config/lending.cjs";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { v, json } from "./lib/rh-live.mjs";
import {
  connectIndexerDatabase,
  indexerStore,
} from "./lib/rh-indexer-store.mjs";
import { descriptorHash, replayEvents } from "./lib/rh-indexer.mjs";
import { LevierPairABI } from "../apps/web/src/contracts/generated/lending.ts";
const assert = (value, code) => {
  if (!value) throw Error(code);
};
let sql;
try {
  const env = parseEnv(readFileSync(".env.testnet", "utf8")),
    d = lendingConfig.deploymentSchema.parse(
      JSON.parse(env.LENDING_DEPLOYMENT_JSON),
    );
  assert(
    env.NETWORK_MODE === "TESTNET" &&
      env.CHAIN_ID === "46630" &&
      d.chainId === 46630,
    "TESTNET_REQUIRED",
  );
  sql = connectIndexerDatabase(env);
  const scope = {
      chainId: d.chainId,
      pair: d.pair.toLowerCase(),
      startBlock: BigInt(env.MARKET_DEPLOYMENT_START_BLOCK),
      descriptorHash: descriptorHash(d),
    },
    store = indexerStore(sql, scope);
  await store.lock();
  const checkpoint = await store.checkpoint(),
    events = (await store.events()).map((x) => x.payload),
    batches = (await store.batches()).reverse();
  assert(checkpoint?.reconciled, "CHECKPOINT_NOT_RECONCILED");
  let next = scope.startBlock;
  for (const b of batches) {
    assert(BigInt(b.from_block) === next, "BLOCK_GAP");
    next = BigInt(b.to_block) + 1n;
  }
  assert(next === BigInt(checkpoint.block_number) + 1n, "CHECKPOINT_GAP");
  const actualHistory = JSON.parse(
    readFileSync("docs/evidence/rh-wallet-acceptance/history.json", "utf8"),
  ).rows.filter((x) => x.action !== "approval");
  for (const expected of actualHistory) {
    const matching = events.filter(
      (e) =>
        e.transactionHash === expected.hash &&
        e.action === expected.action &&
        e.user === env.TESTER_ADDRESS.toLowerCase() &&
        e.amountRaw === expected.amountRaw,
    );
    assert(matching.length === 1, "TESTER_HISTORY_MISMATCH");
  }
  assert(events.length >= 8, "UNEXPECTED_EVENT_COUNT");
  const c = v.createPublicClient({
    transport: v.http(env.RPC_URL, {
      timeout: Number(env.RPC_TIMEOUT_MS),
      retryCount: 0,
    }),
    cacheTime: 0,
  });
  assert((await c.getChainId()) === 46630, "CHAIN_MISMATCH");
  const block = await c.getBlock({
    blockNumber: BigInt(checkpoint.block_number),
  });
  assert(block.hash === checkpoint.block_hash, "CHECKPOINT_REORGED");
  const accounts = replayEvents(events),
    stored =
      await sql`select user_address,collateral_raw,debt_raw,block_number,block_hash from public.rh_lending_accounts where chain_id=${scope.chainId} and pair_address=${scope.pair}`;
  assert(
    stored.length === Object.keys(accounts).length,
    "ACCOUNT_COUNT_MISMATCH",
  );
  for (const row of stored) {
    const p = accounts[row.user_address];
    const observed = await c.readContract({
      address: d.pair,
      abi: LevierPairABI,
      functionName: "accounts",
      args: [row.user_address],
      blockNumber: BigInt(checkpoint.block_number),
    });
    assert(
      BigInt(row.collateral_raw) === p.collateral &&
        p.collateral === observed[0] &&
        BigInt(row.debt_raw) === p.debt &&
        p.debt === observed[1] &&
        row.block_number === checkpoint.block_number &&
        row.block_hash === checkpoint.block_hash,
      "POSITION_MISMATCH",
    );
  }
  const tables =
    await sql`select relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT') as anon_read,has_table_privilege('authenticated',oid,'INSERT') as browser_insert from pg_class where relnamespace='public'::regnamespace and relname in ('rh_lending_checkpoints','rh_lending_batches','rh_lending_events','rh_lending_accounts')`;
  assert(
    tables.length === 4 &&
      tables.every(
        (x) => x.relrowsecurity && !x.anon_read && !x.browser_insert,
      ),
    "ACCESS_CONTROL_MISMATCH",
  );
  let duplicateRejected = false;
  try {
    await store.commit({
      previousBlock: checkpoint.block_number,
      from: String(BigInt(checkpoint.block_number) + 1n),
      to: String(BigInt(checkpoint.block_number) + 1n),
      blockHash: checkpoint.block_hash,
      events: [events[0]],
      accounts,
    });
  } catch (error) {
    duplicateRejected = error.code === "23505";
  }
  assert(duplicateRejected, "DUPLICATE_NOT_REJECTED");
  assert(
    JSON.stringify(await store.checkpoint()) === JSON.stringify(checkpoint) &&
      (await store.events()).length === events.length &&
      (await store.batches()).length === batches.length,
    "PARTIAL_COMMIT",
  );
  let second;
  let concurrentWriterRejected = false;
  try {
    second = connectIndexerDatabase(env);
    try {
      await indexerStore(second, scope).lock();
    } catch (error) {
      concurrentWriterRejected = error.message === "INDEXER_ALREADY_RUNNING";
    }
  } finally {
    if (second) await second.end({ timeout: 5 });
  }
  assert(concurrentWriterRejected, "CONCURRENT_WRITER_ALLOWED");
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: scope.chainId,
    pair: scope.pair,
    startBlock: String(scope.startBlock),
    checkpoint: checkpoint.block_number,
    blockHash: checkpoint.block_hash,
    batches: batches.length,
    contiguousCoverage: true,
    financialEvents: events.length,
    testerEventsMatched: actualHistory.length,
    accounts,
    positionsMatchChainAndDatabase: true,
    duplicateRejected,
    failedBatchRolledBack: true,
    concurrentWriterRejected,
    accessControl: tables,
    events,
  };
  writeFileSync(
    "docs/evidence/rh-canonical-indexer/acceptance.json",
    json(report) + "\n",
  );
  console.log(json({ ...report, events: undefined }));
} catch (error) {
  console.error(
    "Indexer acceptance failed; provider and database details are redacted.",
  );
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
