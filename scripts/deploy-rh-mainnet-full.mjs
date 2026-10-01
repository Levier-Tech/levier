import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { acquireLock } from "./lib/process-lock.mjs";

// Robinhood Chain MAINNET deployment (v2, upgradeable) of every non-Pons contract in one
// journaled run. Each Levier contract is an implementation behind an ERC1967 UUPS proxy that is
// initialized in its creation transaction, so the proxy address stays fixed across upgrades:
// registry, lending router, AutoProtect, ShortRouter, LeverageRouter, vault, VerifiedFeedOracle,
// a long and a short LevierPair per market (one shared implementation) and one MarginRouter per
// market. The v1 Uniswap V2 factory and its empty pools are reused. Every market is registered
// PAUSED, every module starts paused, and only the lending router is authorized.
//
//   --plan    rehearses the whole sequence on a local anvil fork of mainnet (no mainnet tx)
//   --deploy  broadcasts to mainnet; resumable from the journal after any interruption
//   --verify  read-only checks of the deployed mainnet state; writes the deployment record
const require = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const profile = ".env.mainnet.core.local";
const configPath = "scripts/mainnet-full-deploy.config.json";
const directory = ".secrets/rh-mainnet-proxies";
const v1RecordPath = "packages/contracts/deployments/mainnet-4663-v1.json";
const recordPath = "packages/contracts/deployments/mainnet-4663.json";
const CHAIN_ID = 4663;
const STATUS_PAUSED = 2;
const TIER_EXPERIMENTAL = 3;

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const json = (value) =>
  JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
const log = (value) => console.log(json(value));
function save(path, value) {
  writeFileSync(`${path}.tmp`, `${json(value)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function privateUntracked(path) {
  execFileSync("git", ["check-ignore", "-q", path], { stdio: "pipe" });
  check(
    !execFileSync("git", ["ls-files", "--", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
    "PRIVATE_PATH_MUST_BE_UNTRACKED",
  );
  if (existsSync(path))
    check(
      (statSync(path).mode & 0o077) === 0,
      "PRIVATE_PATH_PERMISSIONS_REQUIRED",
    );
}
function positive(env, name) {
  check(/^[1-9][0-9]*$/.test(env[name] ?? ""), `${name}_REQUIRED`);
  return BigInt(env[name]);
}

// ---------- artifacts ----------
const forgeCache = new Map();
function forge(name) {
  if (forgeCache.has(name)) return forgeCache.get(name);
  const a = JSON.parse(
    readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
  );
  const metadata = a.metadata ?? JSON.parse(a.rawMetadata);
  for (const [source, info] of Object.entries(metadata.sources))
    check(
      v.keccak256(readFileSync(resolve("packages/contracts", source))) ===
        info.keccak256,
      "ARTIFACT_SOURCE_CHANGED_REBUILD_REQUIRED",
    );
  const out = {
    name,
    abi: a.abi,
    bytecode: a.bytecode.object,
    runtime: a.deployedBytecode.object,
    immutableReferences: a.deployedBytecode.immutableReferences ?? {},
  };
  forgeCache.set(name, out);
  return out;
}
function vendor(name) {
  const a = JSON.parse(
    readFileSync(
      `packages/contracts/vendor/uniswap-v2-core/build/${name}.json`,
      "utf8",
    ),
  );
  const hex = (s) => (s.startsWith("0x") ? s : `0x${s}`);
  return {
    name,
    abi: a.abi,
    bytecode: hex(a.bytecode),
    runtime: hex(a.evm.deployedBytecode.object),
  };
}
function normalizeRuntime(code, references = {}) {
  let hex = code.slice(2).toLowerCase();
  for (const locations of Object.values(references))
    for (const { start, length } of locations)
      hex =
        hex.slice(0, start * 2) +
        "0".repeat(length * 2) +
        hex.slice((start + length) * 2);
  return hex;
}

// ---------- configuration ----------
function loadProfile() {
  privateUntracked(profile);
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(
    env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === String(CHAIN_ID),
    "ROBINHOOD_MAINNET_REQUIRED",
  );
  check(
    ["TRADING_ENABLED", "LENDING_ENABLED", "MARGIN_TRADING_ENABLED"].every(
      (k) => env[k] === "false",
    ),
    "MARKET_EXECUTION_MUST_STAY_DISABLED",
  );
  check(new URL(env.RPC_URL).protocol === "https:", "HTTPS_RPC_REQUIRED");
  const account = privateKeyToAccount(env.PRIVATE_KEY);
  check(
    same(account.address, env.DEPLOYER_ADDRESS),
    "SIGNER_IDENTITY_MISMATCH",
  );
  // Market registration and pausing are owner calls sent by the deployer in this run.
  // A separate owner (e.g. a Safe) receives ownership afterwards via transferOwnership.
  check(
    same(env.PROTOCOL_OWNER_ADDRESS, account.address),
    "FULL_DEPLOY_REQUIRES_OWNER_EQUALS_DEPLOYER",
  );
  for (const key of [
    "MAINNET_VAULT_NAME",
    "MAINNET_VAULT_SYMBOL",
    "MAINNET_VAULT_SLUG",
    "MAINNET_VAULT_RISK_TIER",
  ])
    check(
      /^[A-Za-z0-9 _-]{1,80}$/.test(env[key] ?? ""),
      "VAULT_METADATA_REQUIRED",
    );
  return { env, account };
}
function loadConfig(env) {
  const c = JSON.parse(readFileSync(configPath, "utf8"));
  check(c.version === 1 && c.chainId === CHAIN_ID, "CONFIG_VERSION_MISMATCH");
  check(
    same(c.oracle.stable.token, env.MAINNET_VAULT_ASSET_ADDRESS),
    "VAULT_ASSET_MUST_BE_CONFIG_STABLE",
  );
  check(
    c.oracle.sequencer === v.zeroAddress && c.oracle.sequencerGracePeriod === 0,
    "SEQUENCER_POLICY_MISMATCH",
  );
  const symbols = new Set();
  for (const m of c.markets) {
    check(!symbols.has(m.symbol), "DUPLICATE_MARKET");
    symbols.add(m.symbol);
    for (const side of [m.long, m.short])
      check(
        side.maxLtvBps < side.liquidationLtvBps &&
          side.liquidationLtvBps <= 10000 &&
          side.maxLeverageBps >= 10000 &&
          BigInt(side.supplyCapRaw) > 0n &&
          BigInt(side.borrowCapRaw) > 0n,
        "INVALID_MARKET_RISK",
      );
  }
  return c;
}

// ---------- deterministic operation list ----------
function buildOperations(env, c, deployer, startNonce) {
  const ops = [];
  const addr = {};
  let nonce = startNonce;
  const deploy = (role, artifact, args) => {
    const data = v.encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
    });
    const address = v.getContractAddress({
      from: deployer,
      nonce: BigInt(nonce),
    });
    addr[role] = address;
    ops.push({
      id: `deploy-${role}`,
      kind: "deploy",
      role,
      contract: artifact.name,
      nonce: nonce++,
      to: null,
      data,
      dataHash: v.keccak256(data),
      predicted: address,
    });
  };
  const call = (id, to, abi, functionName, args) => {
    const data = v.encodeFunctionData({ abi, functionName, args });
    ops.push({
      id,
      kind: "call",
      nonce: nonce++,
      to,
      data,
      dataHash: v.keccak256(data),
    });
  };
  const usdg = c.oracle.stable.token;
  const registryAbi = forge("LevierMarketRegistry").abi;
  const proxyArtifact = forge("ERC1967Proxy");
  // One implementation per contract type, then a proxy per instance initialized on creation.
  const implementation = (name) => {
    if (!addr[`impl-${name}`]) deploy(`impl-${name}`, forge(name), []);
    return addr[`impl-${name}`];
  };
  const proxy = (role, name, args) => {
    const init = v.encodeFunctionData({
      abi: forge(name).abi,
      functionName: "initialize",
      args,
    });
    deploy(role, proxyArtifact, [implementation(name), init]);
  };

  proxy("registry", "LevierMarketRegistry", [deployer]);
  proxy("lendingRouter", "LevierRouter", [deployer]);
  proxy("autoProtect", "AutoProtectModule", [deployer]);
  proxy("shortRouter", "ShortRouter", [deployer]);
  proxy("vault", "LevierVault", [
    usdg,
    env.MAINNET_VAULT_NAME,
    env.MAINNET_VAULT_SYMBOL,
    env.MAINNET_VAULT_SLUG,
    env.MAINNET_VAULT_RISK_TIER,
    deployer,
  ]);
  proxy("leverageRouter", "LeverageRouter", [deployer]);

  const feedInput = (f) => ({
    asset: f.token,
    feed: f.feed,
    description: f.feedDescription,
    maxAge: BigInt(f.maxAge),
    minPrice18: BigInt(f.minPrice18),
    maxPrice18: BigInt(f.maxPrice18),
    checkTokenPause: f.checkTokenPause ?? true,
  });
  proxy("oracle", "VerifiedFeedOracle", [
    deployer,
    BigInt(CHAIN_ID),
    c.oracle.sequencer,
    BigInt(c.oracle.sequencerGracePeriod),
    [feedInput(c.oracle.stable), ...c.markets.map(feedInput)],
  ]);

  const marketId = (slug, collateral, debt) =>
    v.keccak256(
      v.encodePacked(
        ["string", "address", "address"],
        [slug, collateral, debt],
      ),
    );
  const register = (key, side, collateral, debt) => {
    const id = marketId(side.slug, collateral, debt);
    proxy(key, "LevierPair", [
      id,
      collateral,
      debt,
      addr.oracle,
      addr.registry,
      deployer,
    ]);
    call(`register-${key}`, addr.registry, registryAbi, "addMarket", [
      side.slug,
      collateral,
      debt,
      addr[key],
      addr.oracle,
      TIER_EXPERIMENTAL,
      BigInt(side.maxLtvBps),
      BigInt(side.liquidationLtvBps),
      BigInt(side.maxLeverageBps),
      BigInt(side.supplyCapRaw),
      BigInt(side.borrowCapRaw),
    ]);
    call(`pause-${key}`, addr.registry, registryAbi, "setMarketStatus", [
      id,
      STATUS_PAUSED,
    ]);
    return id;
  };
  const markets = {};
  for (const m of c.markets) {
    const s = m.symbol.toLowerCase();
    markets[m.symbol] = {
      longId: register(`long-${s}`, m.long, m.token, usdg),
      shortId: register(`short-${s}`, m.short, usdg, m.token),
    };
  }

  // Reuse the v1 Uniswap V2 factory and its pools: standard, verified and still empty.
  const v1 = JSON.parse(readFileSync(v1RecordPath, "utf8"));
  addr.v2Factory = v.getAddress(v1.addresses.v2Factory);
  for (const m of c.markets) {
    const s = m.symbol.toLowerCase();
    addr[`pool-${s}`] = v.getAddress(v1.addresses[`pool-${s}`]);
  }
  for (const m of c.markets) {
    const s = m.symbol.toLowerCase();
    proxy(`margin-${s}`, "MarginRouter", [
      m.token,
      usdg,
      addr[`long-${s}`],
      addr[`short-${s}`],
      addr[`pool-${s}`],
      deployer,
    ]);
  }
  if (c.lendingRouterAuthorized)
    call(
      "authorize-lending-router",
      addr.registry,
      registryAbi,
      "setAuthorizedRouter",
      [addr.lendingRouter, true],
    );
  return { ops, addr, markets };
}

// ---------- post-deploy verification (read-only) ----------
async function verifyState(client, env, c, deployer, built) {
  const { addr, markets } = built;
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const runtime = async (address, artifact) => {
    const code = await client.getCode({ address });
    check(code && code !== "0x", `MISSING_CODE_${artifact.name}`);
    check(
      artifact.immutableReferences
        ? normalizeRuntime(code, artifact.immutableReferences) ===
            normalizeRuntime(artifact.runtime, artifact.immutableReferences)
        : code.toLowerCase() === artifact.runtime.toLowerCase(),
      `RUNTIME_MISMATCH_${artifact.name}`,
    );
  };
  const usdg = c.oracle.stable.token;
  const reg = forge("LevierMarketRegistry");
  const roles = {
    registry: reg,
    lendingRouter: forge("LevierRouter"),
    autoProtect: forge("AutoProtectModule"),
    shortRouter: forge("ShortRouter"),
    vault: forge("LevierVault"),
    leverageRouter: forge("LeverageRouter"),
    oracle: forge("VerifiedFeedOracle"),
    v2Factory: vendor("UniswapV2Factory"),
  };
  for (const m of c.markets) {
    const s = m.symbol.toLowerCase();
    roles[`long-${s}`] = forge("LevierPair");
    roles[`short-${s}`] = forge("LevierPair");
    roles[`margin-${s}`] = forge("MarginRouter");
    roles[`pool-${s}`] = vendor("UniswapV2Pair");
  }
  const proxyArtifact = forge("ERC1967Proxy");
  const IMPLEMENTATION_SLOT =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implementations = {};
  for (const [role, artifact] of Object.entries(roles)) {
    if (role === "v2Factory" || role.startsWith("pool-")) {
      await runtime(addr[role], artifact);
      continue;
    }
    await runtime(addr[role], proxyArtifact);
    const slot = await client.getStorageAt({
      address: addr[role],
      slot: IMPLEMENTATION_SLOT,
    });
    const impl = v.getAddress(`0x${slot.slice(-40)}`);
    check(same(impl, addr[`impl-${artifact.name}`]), `IMPLEMENTATION_MISMATCH_${role}`);
    await runtime(impl, artifact);
    implementations[artifact.name] = impl;
  }

  for (const role of Object.keys(roles).filter(
    (r) => r !== "v2Factory" && !r.startsWith("pool-"),
  ))
    check(
      same(await read(addr[role], roles[role].abi, "owner"), deployer),
      `OWNER_MISMATCH_${role}`,
    );
  for (const role of ["autoProtect", "shortRouter", "leverageRouter"])
    check(
      await read(addr[role], roles[role].abi, "isPaused"),
      `MODULE_MUST_BE_PAUSED_${role}`,
    );
  const vault = roles.vault.abi;
  check(
    same(await read(addr.vault, vault, "asset"), usdg) &&
      (await read(addr.vault, vault, "depositsPaused")) &&
      (await read(addr.vault, vault, "totalSupply")) === 0n,
    "VAULT_CONFIGURATION_MISMATCH",
  );

  const oracle = roles.oracle.abi;
  check(
    (await read(addr.oracle, oracle, "chainId")) === BigInt(CHAIN_ID) &&
      same(await read(addr.oracle, oracle, "sequencerFeed"), v.zeroAddress),
    "ORACLE_CONFIGURATION_MISMATCH",
  );
  const prices = {};
  for (const f of [c.oracle.stable, ...c.markets])
    prices[f.symbol] = await read(addr.oracle, oracle, "getPrice", [f.token]);

  check(
    (await read(addr.registry, reg.abi, "getMarketCount")) ===
      BigInt(c.markets.length * 2),
    "UNEXPECTED_MARKET_COUNT",
  );
  for (const m of c.markets) {
    const s = m.symbol.toLowerCase();
    for (const [key, id, side, collateral, debt] of [
      [`long-${s}`, markets[m.symbol].longId, m.long, m.token, usdg],
      [`short-${s}`, markets[m.symbol].shortId, m.short, usdg, m.token],
    ]) {
      const market = await read(addr.registry, reg.abi, "getMarket", [id]);
      check(
        same(market.pairAddress, addr[key]) &&
          same(market.collateralToken, collateral) &&
          same(market.debtToken, debt) &&
          same(market.oracle, addr.oracle) &&
          market.status === STATUS_PAUSED &&
          market.maxLtvBps === BigInt(side.maxLtvBps) &&
          market.liquidationLtvBps === BigInt(side.liquidationLtvBps) &&
          market.supplyCap === BigInt(side.supplyCapRaw) &&
          market.borrowCap === BigInt(side.borrowCapRaw),
        `MARKET_MISMATCH_${key}`,
      );
    }
    const pool = await read(
      addr.v2Factory,
      roles.v2Factory.abi,
      "getPair",
      [m.token, usdg],
    );
    check(same(pool, addr[`pool-${s}`]), `POOL_MISMATCH_${s}`);
    const margin = roles[`margin-${s}`].abi;
    check(
      (await read(addr[`margin-${s}`], margin, "isPaused")) &&
        same(await read(addr[`margin-${s}`], margin, "owner"), deployer) &&
        same(await read(addr[`margin-${s}`], margin, "pool"), pool),
      `MARGIN_MISMATCH_${s}`,
    );
  }
  const authorized = (a) =>
    read(addr.registry, reg.abi, "isAuthorizedRouter", [a]);
  check(
    (await authorized(addr.lendingRouter)) === c.lendingRouterAuthorized,
    "LENDING_ROUTER_AUTHORIZATION_MISMATCH",
  );
  for (const role of [
    "leverageRouter",
    "shortRouter",
    ...c.markets.map((m) => `margin-${m.symbol.toLowerCase()}`),
  ])
    check(!(await authorized(addr[role])), `ROUTER_MUST_NOT_BE_AUTHORIZED_${role}`);
  return prices;
}

// ---------- chain clients ----------
function clientsFor(rpcUrl, env, account, timeout) {
  const chain = v.defineChain({
    id: CHAIN_ID,
    name: env.CHAIN_NAME,
    nativeCurrency: {
      name: env.NATIVE_CURRENCY_NAME,
      symbol: env.NATIVE_CURRENCY_SYMBOL,
      decimals: Number(env.NATIVE_CURRENCY_DECIMALS),
    },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const transport = v.http(rpcUrl, { timeout, retryCount: 1 });
  return {
    client: v.createPublicClient({ chain, transport, cacheTime: 0 }),
    wallet: v.createWalletClient({ account, chain, transport }),
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
  const anvil = spawn(
    "anvil",
    ["--fork-url", rpcUrl, "--port", String(port), "--silent", "--no-mining"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  anvil.stderr.on("data", () => {});
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
      });
      if (r.ok) return { url, stop: () => anvil.kill("SIGTERM") };
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  anvil.kill("SIGTERM");
  throw Error("ANVIL_FORK_DID_NOT_START");
}

// ---------- main ----------
let release;
let stage = "configuration";
let fork;
try {
  const mode = process.argv[2];
  check(
    process.argv.length === 3 &&
      ["--plan", "--deploy", "--verify"].includes(mode),
    "EXPLICIT_MAINNET_FULL_MODE_REQUIRED",
  );
  const { env, account } = loadProfile();
  const c = loadConfig(env);
  const timeout = Number(positive(env, "MAINNET_RECEIPT_TIMEOUT_MS"));
  const confirmations = Number(positive(env, "MAINNET_RECEIPT_CONFIRMATIONS"));
  privateUntracked(`${directory}/state.json`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const statePath = `${directory}/state.json`;
  const planPath = `${directory}/plan.json`;
  const main = clientsFor(env.RPC_URL, env, account, timeout);
  check(
    (await main.client.getChainId()) === CHAIN_ID,
    "RPC_CHAIN_MISMATCH",
  );

  if (mode === "--plan") {
    stage = "plan";
    const [latest, pending, balance, gasPrice] = await Promise.all([
      main.client.getTransactionCount({
        address: account.address,
        blockTag: "latest",
      }),
      main.client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
      main.client.getBalance({ address: account.address }),
      main.client.getGasPrice(),
    ]);
    check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
    check(!existsSync(statePath), "JOURNAL_EXISTS_RESUME_WITH_DEPLOY");
    const built = buildOperations(env, c, account.address, latest);
    for (const [role, address] of Object.entries(built.addr)) {
      if (role === "v2Factory" || role.startsWith("pool-")) continue;
      const code = await main.client.getCode({ address });
      check(!code || code === "0x", `PREDICTED_ADDRESS_HAS_CODE_${role}`);
    }

    stage = "fork-rehearsal";
    fork = await startFork(env.RPC_URL);
    const local = clientsFor(fork.url, env, account, timeout);
    // Fork-only: anvil's own fee market differs from Robinhood's, so the rehearsal
    // funds the deployer locally. The real balance is checked per transaction in --deploy.
    await local.client.request({
      method: "anvil_setBalance",
      params: [account.address, v.toHex(10n ** 18n)],
    });
    const results = [];
    for (const op of built.ops) {
      stage = `fork-${op.id}`;
      const gas = await local.client.estimateGas({
        account: account.address,
        to: op.to ?? undefined,
        data: op.data,
      });
      const hash = await local.wallet.sendTransaction({
        to: op.to ?? undefined,
        data: op.data,
        nonce: op.nonce,
        gas: (gas * 13000n) / 10000n,
      });
      await local.client.request({ method: "evm_mine", params: [] });
      const receipt = await local.client.waitForTransactionReceipt({ hash });
      check(receipt.status === "success", `FORK_REVERTED_${op.id}`);
      if (op.kind === "deploy")
        check(
          same(receipt.contractAddress, op.predicted),
          `FORK_ADDRESS_MISMATCH_${op.id}`,
        );
      results.push({ id: op.id, gasUsed: receipt.gasUsed });
    }
    stage = "fork-verify";
    const prices = await verifyState(
      local.client,
      env,
      c,
      account.address,
      built,
    );
    fork.stop();
    fork = undefined;

    // Anvil does not price Nitro parent-chain data, so mainnet gas is estimated with a margin.
    const forkGas = results.reduce((n, r) => n + r.gasUsed, 0n);
    const estimatedGas = (forkGas * 15000n) / 10000n;
    const estimatedFeeWei = estimatedGas * gasPrice;
    const report = {
      chainId: CHAIN_ID,
      deployer: account.address,
      owner: account.address,
      startNonce: latest,
      transactionCount: built.ops.length,
      forkGasUsed: forkGas,
      estimatedMainnetGas: estimatedGas,
      gasPriceWei: gasPrice,
      estimatedFeeWei,
      estimatedFeeEth: v.formatEther(estimatedFeeWei),
      balanceWei: balance,
      balanceEth: v.formatEther(balance),
      addresses: built.addr,
      markets: built.markets,
      oraclePrices18OnFork: prices,
      operations: built.ops.map((op, i) => ({
        id: op.id,
        nonce: op.nonce,
        to: op.to,
        dataHash: op.dataHash,
        predicted: op.predicted,
        forkGasUsed: results[i].gasUsed,
      })),
      rehearsal: "PASSED",
      transactionsSubmittedToMainnet: 0,
    };
    save(planPath, report);
    log({
      rehearsal: "PASSED",
      startNonce: latest,
      transactions: built.ops.length,
      forkGasUsed: forkGas,
      estimatedFeeEth: report.estimatedFeeEth,
      balanceEth: report.balanceEth,
      addresses: built.addr,
      oraclePrices18OnFork: prices,
    });
  } else if (mode === "--deploy") {
    stage = "deploy";
    check(
      env.MAINNET_FULL_BROADCAST_ENABLED === "true",
      "MAINNET_BROADCAST_NOT_AUTHORIZED",
    );
    const perTx = positive(env, "MAINNET_MAX_TRANSACTION_GAS_WEI");
    const total = positive(env, "MAINNET_FULL_MAX_TOTAL_GAS_WEI");
    const feeCap = positive(env, "MAINNET_MAX_FEE_PER_GAS_WEI");
    const reserve = positive(env, "MAINNET_MINIMUM_GAS_RESERVE_WEI");
    const buffer = positive(env, "MAINNET_GAS_LIMIT_BUFFER_BPS");
    check(buffer >= 10000n && buffer <= 20000n, "INVALID_GAS_BUFFER");
    check(existsSync(planPath), "PLAN_REQUIRED");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    check(plan.rehearsal === "PASSED", "PLAN_NOT_REHEARSED");
    const built = buildOperations(env, c, account.address, plan.startNonce);
    check(
      built.ops.length === plan.operations.length &&
        built.ops.every(
          (op, i) =>
            op.id === plan.operations[i].id &&
            op.dataHash === plan.operations[i].dataHash &&
            op.nonce === plan.operations[i].nonce,
        ),
      "PLAN_CHANGED_REPLAN_REQUIRED",
    );
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : {
          chainId: CHAIN_ID,
          deployer: account.address,
          startNonce: plan.startNonce,
          operations: {},
          spentWei: "0",
        };
    check(
      state.chainId === CHAIN_ID &&
        same(state.deployer, account.address) &&
        state.startNonce === plan.startNonce,
      "JOURNAL_IDENTITY_MISMATCH",
    );
    const persist = () => save(statePath, state);
    const settle = async (op, entry) => {
      const receipt = await main.client.waitForTransactionReceipt({
        hash: entry.hash,
        confirmations,
        timeout,
      });
      check(
        receipt.status === "success",
        `MAINNET_REVERTED_${op.id}_RECONCILIATION_REQUIRED`,
      );
      if (op.kind === "deploy")
        check(
          same(receipt.contractAddress, op.predicted),
          `MAINNET_ADDRESS_MISMATCH_${op.id}`,
        );
      entry.status = "success";
      entry.gasUsed = String(receipt.gasUsed);
      entry.costWei = String(receipt.gasUsed * receipt.effectiveGasPrice);
      entry.block = String(receipt.blockNumber);
      state.spentWei = String(BigInt(state.spentWei) + BigInt(entry.costWei));
      persist();
      log({ stage: "confirmed", id: op.id, hash: entry.hash, address: op.predicted });
    };
    for (const op of built.ops) {
      stage = `deploy-${op.id}`;
      const entry = state.operations[op.id];
      if (entry?.status === "success") continue;
      if (entry?.hash) {
        await settle(op, entry);
        continue;
      }
      const [latest, pending, balance] = await Promise.all([
        main.client.getTransactionCount({
          address: account.address,
          blockTag: "latest",
        }),
        main.client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        }),
        main.client.getBalance({ address: account.address }),
      ]);
      check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
      check(latest === op.nonce, "UNEXPECTED_NONCE_RECONCILIATION_REQUIRED");
      if (op.kind === "deploy") {
        const code = await main.client.getCode({ address: op.predicted });
        check(!code || code === "0x", "PREDICTED_ADDRESS_ALREADY_HAS_CODE");
      }
      const gas =
        ((await main.client.estimateGas({
          account: account.address,
          to: op.to ?? undefined,
          data: op.data,
        })) *
          buffer +
          9999n) /
        10000n;
      const fees = await main.client.estimateFeesPerGas({ type: "eip1559" });
      check(fees.maxFeePerGas <= feeCap, "FEE_PER_GAS_LIMIT_EXCEEDED");
      const cost = gas * fees.maxFeePerGas;
      check(
        cost <= perTx && BigInt(state.spentWei) + cost <= total,
        "MAINNET_GAS_BUDGET_EXCEEDED",
      );
      check(balance >= cost + reserve, "DEPLOYER_BALANCE_BELOW_RESERVE");
      const hash = await main.wallet.sendTransaction({
        to: op.to ?? undefined,
        data: op.data,
        nonce: op.nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      state.operations[op.id] = { hash, nonce: op.nonce, status: "submitted" };
      persist();
      log({ stage: "submitted", id: op.id, hash });
      await settle(op, state.operations[op.id]);
    }
    state.complete = true;
    persist();
    log({
      stage: "deploy-complete",
      transactions: built.ops.length,
      spentEth: v.formatEther(BigInt(state.spentWei)),
      next: "npm run rh:mainnet:full:verify",
    });
  } else {
    stage = "verify";
    check(existsSync(statePath), "JOURNAL_REQUIRED");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    check(state.complete === true, "DEPLOYMENT_INCOMPLETE");
    const built = buildOperations(env, c, account.address, state.startNonce);
    const prices = await verifyState(
      main.client,
      env,
      c,
      account.address,
      built,
    );
    const record = {
      network: "Robinhood Chain",
      chainId: CHAIN_ID,
      deployer: account.address,
      owner: account.address,
      verifiedAt: new Date().toISOString(),
      addresses: built.addr,
      markets: Object.fromEntries(
        c.markets.map((m) => [
          m.symbol,
          {
            token: m.token,
            feed: m.feed,
            longMarketId: built.markets[m.symbol].longId,
            shortMarketId: built.markets[m.symbol].shortId,
            status: "PAUSED",
          },
        ]),
      ),
      usdg: c.oracle.stable.token,
      oraclePrices18: prices,
      transactions: Object.fromEntries(
        built.ops.map((op) => [op.id, state.operations[op.id]?.hash]),
      ),
      spentEth: v.formatEther(BigInt(state.spentWei)),
    };
    writeFileSync(recordPath, `${json(record)}\n`);
    log({ stage: "verified", record: recordPath, addresses: built.addr });
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(
    json({
      stage,
      error: /^[A-Z][A-Z0-9_]+$/.test(message)
        ? message
        : (error?.shortMessage ?? "MAINNET_FULL_DEPLOY_FAILED_DETAILS_REDACTED"),
    }),
  );
  process.exitCode = 1;
} finally {
  if (release) release();
}
