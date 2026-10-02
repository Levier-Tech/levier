import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { acquireLock } from "./lib/process-lock.mjs";

// Deploys Pons leverage (PonsV4TwapOracle, PonsLiquidityVault, PonsPerpManager behind UUPS proxies)
// next to the live v2 mainnet deployment, from scripts/mainnet-pons-deploy.config.json. Operations:
//   - VerifiedFeedOracle.addFeed(WETH, ETH/USD) unless the feed exists (used to price the ETH pools)
//   - implementation + proxy for the oracle, the vault and the manager
//   - vault.setManager, oracle.listAsset(market), manager.setMarket(market caps)
// Everything stays closed: opening is paused and vault deposits are paused. The manager also
// refuses to open a position until the Pons factory reports the token as graduated.
//
//   --plan    rehearses every transaction on a local fork of mainnet (no mainnet tx)
//   --run     broadcasts to mainnet (needs MAINNET_PONS_BROADCAST_ENABLED=true); resumable
//   --verify  read-only checks; after a run it also writes the "pons" section of the deployment record
const require = createRequire(new URL("../apps/keeper/package.json", import.meta.url));
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const profile = ".env.mainnet.core.local";
const configPath = "scripts/mainnet-pons-deploy.config.json";
const recordPath = "packages/contracts/deployments/mainnet-4663.json";
const directory = ".secrets/rh-mainnet-pons";
const CHAIN_ID = 4663;
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
function operations(record, config) {
  const owner = record.owner;
  const feedOracle = artifact("VerifiedFeedOracle");
  const oracle = artifact("PonsV4TwapOracle");
  const vault = artifact("PonsLiquidityVault");
  const manager = artifact("PonsPerpManager");
  const proxyArtifact = artifact("ERC1967Proxy");
  const proxy = (implementation, abi, args) =>
    v.encodeDeployData({
      abi: proxyArtifact.abi,
      bytecode: proxyArtifact.bytecode,
      args: [implementation, v.encodeFunctionData({ abi, functionName: "initialize", args })],
    });
  const e = config.ethUsd;
  const m = config.market;
  return [
    {
      id: "add-feed-weth",
      skipIf: async (client) =>
        (await client.readContract({ address: record.addresses.oracle, abi: feedOracle.abi, functionName: "feeds", args: [e.asset] }))[0] !== v.zeroAddress,
      build: () => ({
        to: record.addresses.oracle,
        data: v.encodeFunctionData({
          abi: feedOracle.abi,
          functionName: "addFeed",
          args: [{ asset: e.asset, feed: e.feed, description: e.feedDescription, maxAge: BigInt(e.maxAge), minPrice18: BigInt(e.minPrice18), maxPrice18: BigInt(e.maxPrice18), checkTokenPause: false }],
        }),
      }),
    },
    { id: "deploy-impl-PonsV4TwapOracle", role: "impl-PonsV4TwapOracle", build: () => ({ data: oracle.bytecode }) },
    {
      id: "deploy-ponsOracle",
      role: "ponsOracle",
      build: (x) => ({ data: proxy(x["impl-PonsV4TwapOracle"], oracle.abi, [owner, config.poolManager, config.ponsFactory, config.ponsHook, record.addresses.oracle, e.asset]) }),
    },
    { id: "deploy-impl-PonsLiquidityVault", role: "impl-PonsLiquidityVault", build: () => ({ data: vault.bytecode }) },
    {
      id: "deploy-ponsVault",
      role: "ponsVault",
      build: (x) => ({ data: proxy(x["impl-PonsLiquidityVault"], vault.abi, [config.usdg, config.vault.name, config.vault.symbol, owner]) }),
    },
    { id: "deploy-impl-PonsPerpManager", role: "impl-PonsPerpManager", build: () => ({ data: manager.bytecode }) },
    {
      id: "deploy-ponsManager",
      role: "ponsManager",
      build: (x) => ({ data: proxy(x["impl-PonsPerpManager"], manager.abi, [owner, config.usdg, x.ponsOracle, x.ponsVault, config.ponsFactory]) }),
    },
    { id: "vault-set-manager", build: (x) => ({ to: x.ponsVault, data: v.encodeFunctionData({ abi: vault.abi, functionName: "setManager", args: [x.ponsManager] }) }) },
    { id: `list-${m.symbol.toLowerCase()}`, build: (x) => ({ to: x.ponsOracle, data: v.encodeFunctionData({ abi: oracle.abi, functionName: "listAsset", args: [m.token] }) }) },
    {
      id: `set-market-${m.symbol.toLowerCase()}`,
      build: (x) => ({
        to: x.ponsManager,
        data: v.encodeFunctionData({
          abi: manager.abi,
          functionName: "setMarket",
          args: [m.token, m.maxLeverageBps, m.maintenanceMarginBps, BigInt(m.maxPositionSizeRaw), BigInt(m.maxOpenInterestRaw)],
        }),
      }),
    },
  ];
}

// Sends the operations in order, recording each result in `state` (journal on mainnet).
async function execute({ client, wallet }, account, ops, state, persist, record, feeCap) {
  const x = { ...record.addresses };
  for (const entry of Object.values(state.operations)) if (entry.role && entry.address) x[entry.role] = entry.address;
  let gasUsed = 0n;
  for (const op of ops) {
    const entry = state.operations[op.id];
    if (entry?.status === "success" || entry?.status === "skipped") continue;
    if (op.skipIf && !entry?.hash && (await op.skipIf(client))) {
      state.operations[op.id] = { status: "skipped" };
      persist();
      log({ stage: "skipped", id: op.id, reason: "already configured" });
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
    state.operations[op.id] = { hash, status: "success", role: op.role, address: op.role ? x[op.role] : undefined };
    persist();
    log({ stage: "confirmed", id: op.id, hash, ...(op.role ? { address: x[op.role] } : {}) });
  }
  return { addresses: x, gasUsed };
}

// Read-only checks: code, proxies, owner, closed state, wiring and market caps.
async function verifyPons(client, record, config, x) {
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
  const owner = record.owner;
  for (const [role, name] of [["ponsOracle", "PonsV4TwapOracle"], ["ponsVault", "PonsLiquidityVault"], ["ponsManager", "PonsPerpManager"]]) {
    const a = artifact(name);
    const impl = x[`impl-${name}`];
    check(same(await implementationOf(client, x[role]), impl), `IMPLEMENTATION_MISMATCH_${role}`);
    check(normalizeRuntime(await client.getCode({ address: impl }), a.immutableReferences) === normalizeRuntime(a.runtime, a.immutableReferences), `RUNTIME_MISMATCH_${name}`);
    check(same(await read(x[role], a.abi, "owner"), owner), `OWNER_MISMATCH_${role}`);
  }
  const oracle = artifact("PonsV4TwapOracle").abi;
  const vault = artifact("PonsLiquidityVault").abi;
  const manager = artifact("PonsPerpManager").abi;
  const m = config.market;
  check(
    same(await read(x.ponsOracle, oracle, "poolManager"), config.poolManager) && same(await read(x.ponsOracle, oracle, "ponsFactory"), config.ponsFactory) &&
      same(await read(x.ponsOracle, oracle, "hook"), config.ponsHook) && same(await read(x.ponsOracle, oracle, "ethUsdOracle"), record.addresses.oracle),
    "ORACLE_WIRING_MISMATCH",
  );
  const [poolId] = await read(x.ponsOracle, oracle, "assets", [m.token]);
  check(poolId !== v.zeroHash, "MARKET_NOT_LISTED_ON_ORACLE");
  check(
    same(await read(x.ponsVault, vault, "asset"), config.usdg) && same(await read(x.ponsVault, vault, "manager"), x.ponsManager) &&
      (await read(x.ponsVault, vault, "depositsPaused")),
    "VAULT_MISMATCH",
  );
  check(
    (await read(x.ponsManager, manager, "openingPaused")) && same(await read(x.ponsManager, manager, "vault"), x.ponsVault) &&
      same(await read(x.ponsManager, manager, "oracle"), x.ponsOracle) && same(await read(x.ponsManager, manager, "usdg"), config.usdg),
    "MANAGER_MISMATCH",
  );
  const [listed, maxLeverageBps, maintenanceMarginBps, maxPositionSize, maxOpenInterest] = await read(x.ponsManager, manager, "markets", [m.token]);
  check(
    listed && maxLeverageBps === m.maxLeverageBps && maintenanceMarginBps === m.maintenanceMarginBps &&
      maxPositionSize === BigInt(m.maxPositionSizeRaw) && maxOpenInterest === BigInt(m.maxOpenInterestRaw),
    "MARKET_CONFIG_MISMATCH",
  );
  const ethUsd18 = await read(record.addresses.oracle, artifact("VerifiedFeedOracle").abi, "getPrice", [config.ethUsd.asset]);
  const pick = (...roles) => Object.fromEntries(roles.map((r) => [r, x[r]]));
  return {
    ethUsd18,
    poolId,
    addresses: pick("impl-PonsV4TwapOracle", "ponsOracle", "impl-PonsLiquidityVault", "ponsVault", "impl-PonsPerpManager", "ponsManager"),
  };
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
  const { env, account } = loadProfile();
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  check(same(record.owner, account.address), "SIGNER_IS_NOT_PROTOCOL_OWNER");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const planPath = `${directory}/plan.json`;
  const statePath = `${directory}/state.json`;
  const main = clientsFor(env.RPC_URL, account);
  check((await main.client.getChainId()) === CHAIN_ID, "RPC_CHAIN_MISMATCH");
  const ops = operations(record, config);

  if (mode === "--plan") {
    stage = "plan";
    check(!record.pons, "PONS_ALREADY_RECORDED");
    check(!existsSync(statePath), "JOURNAL_EXISTS_RESUME_WITH_RUN");
    stage = "fork-rehearsal";
    fork = await startFork(env.RPC_URL);
    const local = clientsFor(fork.url, account);
    await local.client.request({ method: "anvil_setBalance", params: [account.address, v.toHex(10n ** 18n)] });
    const ethBalance = await main.client.getBalance({ address: account.address });
    const { addresses, gasUsed } = await execute(local, account, ops, { operations: {} }, () => {}, record, 0n);
    stage = "fork-verify";
    const checked = await verifyPons(local.client, record, config, addresses);
    fork.stop();
    fork = undefined;
    const gasPrice = await main.client.getGasPrice();
    const estimatedFeeWei = (gasUsed * gasPrice * 15n) / 10n;
    const plan = {
      rehearsal: "PASSED",
      market: config.market.symbol,
      transactions: ops.length,
      operations: ops.map((op) => op.id),
      gasUsedOnFork: gasUsed,
      estimatedFeeEth: v.formatEther(estimatedFeeWei),
      ethBalance: v.formatEther(ethBalance),
      enoughEth: ethBalance > estimatedFeeWei,
      ethUsd18OnFork: checked.ethUsd18,
      poolId: checked.poolId,
    };
    save(planPath, plan);
    log(plan);
  } else if (mode === "--run") {
    stage = "run";
    check(env.MAINNET_PONS_BROADCAST_ENABLED === "true", "MAINNET_BROADCAST_NOT_AUTHORIZED");
    check(existsSync(planPath), "PLAN_REQUIRED");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    check(plan.rehearsal === "PASSED", "PLAN_NOT_REHEARSED");
    check(json(ops.map((op) => op.id)) === json(plan.operations), "PLAN_CHANGED_REPLAN_REQUIRED");
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { operations: {} };
    const persist = () => save(statePath, state);
    await execute(main, account, ops, state, persist, record, BigInt(env.MAINNET_MAX_FEE_PER_GAS_WEI));
    state.complete = true;
    persist();
    log({ stage: "run-complete", transactions: ops.length, next: "node scripts/deploy-rh-mainnet-pons.mjs --verify" });
  } else {
    stage = "verify";
    check(existsSync(statePath), "NO_RUN_JOURNAL");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    check(state.complete, "RUN_NOT_COMPLETE");
    const x = { ...record.addresses };
    for (const entry of Object.values(state.operations)) if (entry.role && entry.address) x[entry.role] = entry.address;
    const checked = await verifyPons(main.client, record, config, x);
    if (!record.pons) {
      const transactions = {};
      for (const [id, entry] of Object.entries(state.operations)) if (entry.hash) transactions[id] = entry.hash;
      record.pons = {
        addresses: checked.addresses,
        transactions,
        poolManager: config.poolManager,
        ponsFactory: config.ponsFactory,
        ponsHook: config.ponsHook,
        markets: { [config.market.symbol]: { token: config.market.token, poolId: checked.poolId, status: "PAUSED" } },
      };
      writeFileSync(recordPath, `${json(record)}\n`);
    }
    log({ stage: "verified", ...checked, record: recordPath });
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(json({ stage, error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : (error?.shortMessage ?? "PONS_DEPLOY_FAILED_DETAILS_REDACTED") }));
  process.exitCode = 1;
} finally {
  if (release) release();
}
