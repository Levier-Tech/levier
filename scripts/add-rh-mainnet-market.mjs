import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { acquireLock } from "./lib/process-lock.mjs";

// Adds one market (long + short pair, Uniswap V2 pool, MarginRouter) to the live v2 mainnet
// deployment without touching the four launch markets. The market comes from
// scripts/mainnet-full-deploy.config.json (MAINNET_ADD_MARKET=<symbol>). Operations:
//   - if the oracle proxy still runs the launch implementation: deploy the current
//     VerifiedFeedOracle implementation and upgrade the proxy (adds owner-only addFeed)
//   - oracle.addFeed for the new stock
//   - V2 factory createPair(stock, USDG) unless the pool exists
//   - LevierPair proxies (long, short), registered on the registry and set to PAUSED
//   - MarginRouter proxy (paused, unauthorized)
// The new market stays closed; open it with MAINNET_ENABLE_MARKETS=<symbol> npm run rh:mainnet:markets:interactive.
//
//   --plan    rehearses every transaction on a local fork of mainnet (no mainnet tx)
//   --run     broadcasts to mainnet (needs MAINNET_ADD_BROADCAST_ENABLED=true); resumable
//   --verify  read-only checks; after a run it also writes the market into the deployment record
const require = createRequire(new URL("../apps/keeper/package.json", import.meta.url));
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const profile = ".env.mainnet.core.local";
const configPath = "scripts/mainnet-full-deploy.config.json";
const recordPath = "packages/contracts/deployments/mainnet-4663.json";
const CHAIN_ID = 4663;
const STATUS_PAUSED = 2;
const TIER_EXPERIMENTAL = 3;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const json = (value) => JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
const log = (value) => console.log(json(value));
function save(path, value) {
  writeFileSync(`${path}.tmp`, `${json(value)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function privateUntracked(path) {
  execFileSync("git", ["check-ignore", "-q", path], { stdio: "pipe" });
  if (existsSync(path)) check((statSync(path).mode & 0o077) === 0, "PRIVATE_PATH_PERMISSIONS_REQUIRED");
}
const artifact = (name) => {
  const a = JSON.parse(readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object, runtime: a.deployedBytecode.object, immutableReferences: a.deployedBytecode.immutableReferences ?? {} };
};
// Zeroes immutable values (UUPS stores the implementation's own address) before comparing code.
function normalizeRuntime(code, references) {
  let hex = code.slice(2).toLowerCase();
  for (const locations of Object.values(references))
    for (const { start, length } of locations) hex = hex.slice(0, start * 2) + "0".repeat(length * 2) + hex.slice((start + length) * 2);
  return hex;
}
const factoryAbi = v.parseAbi([
  "function getPair(address,address) view returns (address)",
  "function createPair(address,address) returns (address)",
]);

function loadProfile() {
  privateUntracked(profile);
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === String(CHAIN_ID), "ROBINHOOD_MAINNET_REQUIRED");
  check(new URL(env.RPC_URL).protocol === "https:", "HTTPS_RPC_REQUIRED");
  const account = privateKeyToAccount(env.PRIVATE_KEY);
  check(same(account.address, env.DEPLOYER_ADDRESS), "SIGNER_IDENTITY_MISMATCH");
  return { env, account };
}
function clientsFor(rpcUrl, account) {
  const chain = v.defineChain({
    id: CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = v.http(rpcUrl, { timeout: 60000, retryCount: 1 });
  return {
    client: v.createPublicClient({ chain, transport, cacheTime: 0 }),
    wallet: v.createWalletClient({ account, chain, transport }),
  };
}
async function implementationOf(client, proxy) {
  const slot = await client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT });
  return v.getAddress(`0x${slot.slice(-40)}`);
}

// Ordered operations. `build` receives the addresses known so far (record + earlier deploys of
// this run), so a resumed run rebuilds the same calls from its journal.
function operations(record, config, m, needsOracleUpgrade) {
  const a = record.addresses;
  const s = m.symbol.toLowerCase();
  const usdg = config.oracle.stable.token;
  const pair = artifact("LevierPair");
  const registry = artifact("LevierMarketRegistry");
  const oracle = artifact("VerifiedFeedOracle");
  const proxyArtifact = artifact("ERC1967Proxy");
  const proxy = (implementation, abi, args) =>
    v.encodeDeployData({
      abi: proxyArtifact.abi,
      bytecode: proxyArtifact.bytecode,
      args: [implementation, v.encodeFunctionData({ abi, functionName: "initialize", args })],
    });
  const marketId = (slug, collateral, debt) =>
    v.keccak256(v.encodePacked(["string", "address", "address"], [slug, collateral, debt]));
  const ids = { long: marketId(m.long.slug, m.token, usdg), short: marketId(m.short.slug, usdg, m.token) };
  const ops = [];
  if (needsOracleUpgrade) {
    ops.push({ id: "deploy-impl-VerifiedFeedOracle", role: "impl-VerifiedFeedOracle", build: () => ({ data: oracle.bytecode }) });
    ops.push({
      id: "upgrade-oracle",
      build: (x) => ({ to: a.oracle, data: v.encodeFunctionData({ abi: oracle.abi, functionName: "upgradeToAndCall", args: [x["impl-VerifiedFeedOracle"], "0x"] }) }),
    });
  }
  ops.push({
    id: `add-feed-${s}`,
    build: () => ({
      to: a.oracle,
      data: v.encodeFunctionData({
        abi: oracle.abi,
        functionName: "addFeed",
        args: [{ asset: m.token, feed: m.feed, description: m.feedDescription, maxAge: BigInt(m.maxAge), minPrice18: BigInt(m.minPrice18), maxPrice18: BigInt(m.maxPrice18), checkTokenPause: m.checkTokenPause ?? true }],
      }),
    }),
  });
  ops.push({
    id: `create-pool-${s}`,
    skipIf: async (client) => (await client.readContract({ address: a.v2Factory, abi: factoryAbi, functionName: "getPair", args: [m.token, usdg] })) !== v.zeroAddress,
    build: () => ({ to: a.v2Factory, data: v.encodeFunctionData({ abi: factoryAbi, functionName: "createPair", args: [m.token, usdg] }) }),
  });
  for (const [side, key, collateral, debt] of [["long", `long-${s}`, m.token, usdg], ["short", `short-${s}`, usdg, m.token]]) {
    const cfg = m[side];
    ops.push({ id: `deploy-${key}`, role: key, build: () => ({ data: proxy(a["impl-LevierPair"], pair.abi, [ids[side], collateral, debt, a.oracle, a.registry, record.owner]) }) });
    ops.push({
      id: `register-${key}`,
      build: (x) => ({
        to: a.registry,
        data: v.encodeFunctionData({
          abi: registry.abi,
          functionName: "addMarket",
          args: [cfg.slug, collateral, debt, x[key], a.oracle, TIER_EXPERIMENTAL, BigInt(cfg.maxLtvBps), BigInt(cfg.liquidationLtvBps), BigInt(cfg.maxLeverageBps), BigInt(cfg.supplyCapRaw), BigInt(cfg.borrowCapRaw)],
        }),
      }),
    });
    ops.push({ id: `pause-${key}`, build: () => ({ to: a.registry, data: v.encodeFunctionData({ abi: registry.abi, functionName: "setMarketStatus", args: [ids[side], STATUS_PAUSED] }) }) });
  }
  ops.push({
    id: `deploy-margin-${s}`,
    role: `margin-${s}`,
    build: (x) => ({ data: proxy(a["impl-MarginRouter"], artifact("MarginRouter").abi, [m.token, usdg, x[`long-${s}`], x[`short-${s}`], x[`pool-${s}`], record.owner]) }),
  });
  return { ops, ids };
}

// Sends the operations in order, recording each result in `state` (journal on mainnet).
async function execute({ client, wallet }, account, ops, state, persist, record, m, usdg, feeCap) {
  const x = { ...record.addresses };
  for (const [id, entry] of Object.entries(state.operations)) if (entry.role && entry.address) x[entry.role] = entry.address;
  const s = m.symbol.toLowerCase();
  let gasUsed = 0n;
  for (const op of ops) {
    const entry = state.operations[op.id];
    if (entry?.status === "success" || entry?.status === "skipped") {
      if (op.id.startsWith("create-pool")) x[`pool-${s}`] = await client.readContract({ address: x.v2Factory, abi: factoryAbi, functionName: "getPair", args: [m.token, usdg] });
      continue;
    }
    if (op.skipIf && !entry?.hash && (await op.skipIf(client))) {
      state.operations[op.id] = { status: "skipped" };
      persist();
      x[`pool-${s}`] = await client.readContract({ address: x.v2Factory, abi: factoryAbi, functionName: "getPair", args: [m.token, usdg] });
      log({ stage: "skipped", id: op.id, reason: "pool already exists" });
      continue;
    }
    let hash = entry?.hash;
    if (!hash) {
      const { to, data } = op.build(x);
      const [latest, pending] = await Promise.all(["latest", "pending"].map((blockTag) => client.getTransactionCount({ address: account.address, blockTag })));
      check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
      const gas = ((await client.estimateGas({ account: account.address, to, data })) * 13n) / 10n;
      const fees = await client.estimateFeesPerGas({ type: "eip1559" });
      if (feeCap) check(fees.maxFeePerGas <= feeCap, "FEE_PER_GAS_LIMIT_EXCEEDED");
      hash = await wallet.sendTransaction({ to, data, gas, nonce: latest, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      state.operations[op.id] = { hash, status: "submitted", role: op.role };
      persist();
      log({ stage: "submitted", id: op.id, hash });
    }
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: feeCap ? 2 : 1, timeout: 180000 });
    check(receipt.status === "success", `REVERTED_${op.id}`);
    gasUsed += receipt.gasUsed;
    if (op.role) {
      check(receipt.contractAddress, `NO_CONTRACT_ADDRESS_${op.id}`);
      x[op.role] = v.getAddress(receipt.contractAddress);
    }
    if (op.id.startsWith("create-pool")) x[`pool-${s}`] = await client.readContract({ address: x.v2Factory, abi: factoryAbi, functionName: "getPair", args: [m.token, usdg] });
    state.operations[op.id] = { hash, status: "success", role: op.role, address: op.role ? x[op.role] : undefined };
    persist();
    log({ stage: "confirmed", id: op.id, hash, ...(op.role ? { address: x[op.role] } : {}) });
  }
  return { addresses: x, gasUsed };
}

// Read-only checks of the added market (paused, unauthorized, priced, wired to the right pool).
async function verifyAdded(client, record, config, m, x, ids) {
  const s = m.symbol.toLowerCase();
  const usdg = config.oracle.stable.token;
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
  const reg = artifact("LevierMarketRegistry").abi;
  const oracle = artifact("VerifiedFeedOracle");
  const impl = await implementationOf(client, record.addresses.oracle);
  check(same(impl, x["impl-VerifiedFeedOracle"]), "ORACLE_IMPLEMENTATION_MISMATCH");
  check(normalizeRuntime(await client.getCode({ address: impl }), oracle.immutableReferences) === normalizeRuntime(oracle.runtime, oracle.immutableReferences), "ORACLE_RUNTIME_MISMATCH");
  const price = await read(record.addresses.oracle, oracle.abi, "getPrice", [m.token]);
  for (const t of [config.oracle.stable, ...config.markets.filter((n) => record.markets[n.symbol])])
    await read(record.addresses.oracle, oracle.abi, "getPrice", [t.token]);
  for (const [side, key, collateral, debt] of [["long", `long-${s}`, m.token, usdg], ["short", `short-${s}`, usdg, m.token]]) {
    const market = await read(record.addresses.registry, reg, "getMarket", [ids[side]]);
    check(
      same(market.pairAddress, x[key]) && same(market.collateralToken, collateral) && same(market.debtToken, debt) &&
        same(market.oracle, record.addresses.oracle) && market.status === STATUS_PAUSED &&
        market.borrowCap === BigInt(m[side].borrowCapRaw) && market.supplyCap === BigInt(m[side].supplyCapRaw),
      `MARKET_MISMATCH_${key}`,
    );
    check(same(await implementationOf(client, x[key]), record.addresses["impl-LevierPair"]), `IMPLEMENTATION_MISMATCH_${key}`);
    check(same(await read(x[key], artifact("LevierPair").abi, "owner"), record.owner), `OWNER_MISMATCH_${key}`);
  }
  const pool = await read(record.addresses.v2Factory, factoryAbi, "getPair", [m.token, usdg]);
  check(pool !== v.zeroAddress && same(pool, x[`pool-${s}`]), `POOL_MISMATCH_${s}`);
  const margin = artifact("MarginRouter").abi;
  const router = x[`margin-${s}`];
  check(same(await implementationOf(client, router), record.addresses["impl-MarginRouter"]), "IMPLEMENTATION_MISMATCH_margin");
  check(
    (await read(router, margin, "isPaused")) && same(await read(router, margin, "owner"), record.owner) &&
      same(await read(router, margin, "pool"), pool) && !(await read(record.addresses.registry, reg, "isAuthorizedRouter", [router])),
    `MARGIN_MISMATCH_${s}`,
  );
  return { oraclePrice18: price, pool, addresses: { [`long-${s}`]: x[`long-${s}`], [`short-${s}`]: x[`short-${s}`], [`pool-${s}`]: pool, [`margin-${s}`]: router } };
}

async function freePort() {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}
async function startFork(rpcUrl) {
  const port = await freePort();
  const anvil = spawn("anvil", ["--fork-url", rpcUrl, "--port", String(port), "--silent"], { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return { url, stop: () => anvil.kill("SIGTERM") };
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  anvil.kill("SIGTERM");
  throw Error("ANVIL_FORK_DID_NOT_START");
}

let release;
let stage = "configuration";
let fork;
try {
  const mode = process.argv[2];
  check(process.argv.length === 3 && ["--plan", "--run", "--verify"].includes(mode), "EXPLICIT_MODE_REQUIRED");
  const symbol = (process.env.MAINNET_ADD_MARKET ?? "").trim().toUpperCase();
  check(/^[A-Z]{1,8}$/.test(symbol), "MAINNET_ADD_MARKET_REQUIRED");
  const { env, account } = loadProfile();
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const m = config.markets.find((x) => x.symbol === symbol);
  check(m, "MARKET_NOT_IN_CONFIG");
  check(same(record.owner, account.address), "SIGNER_IS_NOT_PROTOCOL_OWNER");
  const s = symbol.toLowerCase();
  const usdg = config.oracle.stable.token;
  const directory = `.secrets/rh-mainnet-add-${s}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const planPath = `${directory}/plan.json`;
  const statePath = `${directory}/state.json`;
  const main = clientsFor(env.RPC_URL, account);
  check((await main.client.getChainId()) === CHAIN_ID, "RPC_CHAIN_MISMATCH");
  const launchOracleImpl = record.addresses["impl-VerifiedFeedOracle"];

  if (mode === "--plan") {
    stage = "plan";
    check(!record.markets[symbol], "MARKET_ALREADY_RECORDED");
    check(!existsSync(statePath), "JOURNAL_EXISTS_RESUME_WITH_RUN");
    const needsUpgrade = same(await implementationOf(main.client, record.addresses.oracle), launchOracleImpl);
    const { ops, ids } = operations(record, config, m, needsUpgrade);
    stage = "fork-rehearsal";
    fork = await startFork(env.RPC_URL);
    const local = clientsFor(fork.url, account);
    await local.client.request({ method: "anvil_setBalance", params: [account.address, v.toHex(10n ** 18n)] });
    const ethBalance = await main.client.getBalance({ address: account.address });
    const forkState = { operations: {} };
    const { addresses, gasUsed } = await execute(local, account, ops, forkState, () => {}, record, m, usdg, 0n);
    stage = "fork-verify";
    const checked = await verifyAdded(local.client, record, config, m, addresses, ids);
    fork.stop();
    fork = undefined;
    const gasPrice = await main.client.getGasPrice();
    const plan = {
      rehearsal: "PASSED",
      market: symbol,
      oracleUpgrade: needsUpgrade,
      transactions: ops.length,
      operations: ops.map((op) => op.id),
      marketIds: ids,
      estimatedFeeEth: v.formatEther((gasUsed * gasPrice * 15n) / 10n),
      ethBalance: v.formatEther(ethBalance),
      oraclePrice18OnFork: checked.oraclePrice18,
    };
    save(planPath, plan);
    log(plan);
  } else if (mode === "--run") {
    stage = "run";
    check(env.MAINNET_ADD_BROADCAST_ENABLED === "true", "MAINNET_BROADCAST_NOT_AUTHORIZED");
    check(existsSync(planPath), "PLAN_REQUIRED");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    check(plan.rehearsal === "PASSED" && plan.market === symbol, "PLAN_NOT_REHEARSED");
    const { ops } = operations(record, config, m, plan.oracleUpgrade);
    check(json(ops.map((op) => op.id)) === json(plan.operations), "PLAN_CHANGED_REPLAN_REQUIRED");
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { operations: {} };
    const persist = () => save(statePath, state);
    await execute(main, account, ops, state, persist, record, m, usdg, BigInt(env.MAINNET_MAX_FEE_PER_GAS_WEI));
    state.complete = true;
    persist();
    log({ stage: "run-complete", transactions: ops.length, next: `MAINNET_ADD_MARKET=${symbol} node scripts/add-rh-mainnet-market.mjs --verify` });
  } else {
    stage = "verify";
    check(existsSync(statePath), "NO_RUN_JOURNAL");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    check(state.complete, "RUN_NOT_COMPLETE");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const x = { ...record.addresses };
    for (const entry of Object.values(state.operations)) if (entry.role && entry.address) x[entry.role] = entry.address;
    x[`pool-${s}`] = await main.client.readContract({ address: record.addresses.v2Factory, abi: factoryAbi, functionName: "getPair", args: [m.token, usdg] });
    const checked = await verifyAdded(main.client, record, config, m, x, plan.marketIds);
    // Record the new market next to the launch markets. A replaced oracle implementation is kept under "retired".
    if (!record.markets[symbol]) {
      if (plan.oracleUpgrade) {
        record.retired = { ...(record.retired ?? {}), "impl-VerifiedFeedOracle": { address: launchOracleImpl, transaction: record.transactions["deploy-impl-VerifiedFeedOracle"] } };
        record.addresses["impl-VerifiedFeedOracle"] = x["impl-VerifiedFeedOracle"];
      }
      Object.assign(record.addresses, checked.addresses);
      record.markets[symbol] = { token: m.token, feed: m.feed, longMarketId: plan.marketIds.long, shortMarketId: plan.marketIds.short, status: "PAUSED" };
      for (const [id, entry] of Object.entries(state.operations)) if (entry.hash) record.transactions[id] = entry.hash;
      record.oraclePrices18 = { ...(record.oraclePrices18 ?? {}), [symbol]: String(checked.oraclePrice18) };
      writeFileSync(recordPath, `${json(record)}\n`);
    }
    log({ stage: "verified", market: symbol, ...checked, record: recordPath });
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(json({ stage, error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : (error?.shortMessage ?? "ADD_MARKET_FAILED_DETAILS_REDACTED") }));
  process.exitCode = 1;
} finally {
  if (release) release();
}
