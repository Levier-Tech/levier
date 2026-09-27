import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import postgres from "postgres";

export function connectIndexerDatabase(env) {
  const u = new URL(env.DATABASE_URL),
    project = new URL(env.SUPABASE_URL).hostname.split(".")[0];
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:")
    throw Error("DATABASE_PROTOCOL_INVALID");
  const matches =
    u.hostname === `db.${project}.supabase.co` ||
    (/^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) &&
      decodeURIComponent(u.username) === `postgres.${project}`);
  if (!matches || u.port !== "5432") throw Error("DATABASE_PROJECT_MISMATCH");
  const ca =
    env.DATABASE_SSL_CA ||
    (env.DATABASE_SSL_CA_PATH ? readFileSync(env.DATABASE_SSL_CA_PATH, "utf8") : "");
  const cert = new X509Certificate(ca);
  if (
    !cert.ca ||
    cert.fingerprint256.replaceAll(":", "").toLowerCase() !==
      env.DATABASE_SSL_CA_SHA256 ||
    Date.parse(cert.validTo) <= Date.now() ||
    Date.parse(cert.validFrom) > Date.now()
  )
    throw Error("DATABASE_CA_INVALID");
  return postgres({
    host: u.hostname,
    port: Number(u.port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
    ssl: { rejectUnauthorized: true, servername: u.hostname, ca },
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 10,
    connection: { statement_timeout: 30000 },
    onnotice() {},
  });
}
export function indexerStore(sql, scope) {
  const { chainId, pair } = scope;
  return {
    async lock() {
      const [r] =
        await sql`select pg_try_advisory_lock(hashtextextended(${`rh-indexer:${chainId}:${pair}`},0)) as acquired`;
      if (!r.acquired) throw Error("INDEXER_ALREADY_RUNNING");
    },
    async checkpoint() {
      const rows =
        await sql`select * from public.rh_lending_checkpoints where chain_id=${chainId} and pair_address=${pair}`;
      return rows[0] ?? null;
    },
    async batches() {
      return sql`select * from public.rh_lending_batches where chain_id=${chainId} and pair_address=${pair} order by to_block desc`;
    },
    async events() {
      return sql`select payload from public.rh_lending_events where chain_id=${chainId} and pair_address=${pair} order by block_number,log_index`;
    },
    async rollback(ancestor) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`rh-indexer-write:${chainId}:${pair}`},0))`;
        await tx`delete from public.rh_lending_events where chain_id=${chainId} and pair_address=${pair} and block_number>${ancestor?.to_block ?? "-1"}`;
        await tx`delete from public.rh_lending_batches where chain_id=${chainId} and pair_address=${pair} and to_block>${ancestor?.to_block ?? "-1"}`;
        await tx`delete from public.rh_lending_accounts where chain_id=${chainId} and pair_address=${pair}`;
        if (ancestor)
          await tx`update public.rh_lending_checkpoints set block_number=${ancestor.to_block},block_hash=${ancestor.block_hash},reconciled=false,updated_at=now() where chain_id=${chainId} and pair_address=${pair}`;
        else
          await tx`delete from public.rh_lending_checkpoints where chain_id=${chainId} and pair_address=${pair}`;
      });
    },
    async commit(batch) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`rh-indexer-write:${chainId}:${pair}`},0))`;
        const [previous] =
          await tx`select block_number,descriptor_hash,start_block from public.rh_lending_checkpoints where chain_id=${chainId} and pair_address=${pair} for update`;
        if (
          String(previous?.block_number ?? "") !==
          String(batch.previousBlock ?? "")
        )
          throw Error("CHECKPOINT_CONFLICT");
        if (
          previous &&
          (previous.descriptor_hash !== scope.descriptorHash ||
            BigInt(previous.start_block) !== scope.startBlock)
        )
          throw Error("INDEXER_DESCRIPTOR_CHANGED");
        const expectedFrom = previous
          ? BigInt(previous.block_number) + 1n
          : scope.startBlock;
        if (
          BigInt(batch.from) !== expectedFrom ||
          BigInt(batch.to) < expectedFrom
        )
          throw Error("INDEXER_NONCONTIGUOUS_BATCH");
        for (const event of batch.events)
          await tx`insert into public.rh_lending_events(chain_id,pair_address,tx_hash,log_index,block_number,block_hash,user_address,action,payload) values (${chainId},${pair},${event.transactionHash},${event.logIndex},${event.blockNumber},${event.blockHash},${event.user},${event.action},${tx.json(event)})`;
        await tx`insert into public.rh_lending_batches(chain_id,pair_address,from_block,to_block,block_hash) values (${chainId},${pair},${batch.from},${batch.to},${batch.blockHash})`;
        await tx`delete from public.rh_lending_accounts where chain_id=${chainId} and pair_address=${pair}`;
        for (const [user, position] of Object.entries(batch.accounts))
          await tx`insert into public.rh_lending_accounts(chain_id,pair_address,user_address,collateral_raw,debt_raw,block_number,block_hash) values(${chainId},${pair},${user},${String(position.collateral)},${String(position.debt)},${batch.to},${batch.blockHash})`;
        await tx`insert into public.rh_lending_checkpoints(chain_id,pair_address,start_block,descriptor_hash,block_number,block_hash,reconciled) values(${chainId},${pair},${scope.startBlock},${scope.descriptorHash},${batch.to},${batch.blockHash},true) on conflict(chain_id,pair_address) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,reconciled=true,updated_at=now()`;
      });
    },
  };
}
