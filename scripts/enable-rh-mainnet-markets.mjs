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
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { acquireLock } from "./lib/process-lock.mjs";

// Opens the four mainnet markets (TSLA, AMZN, PLTR, AMD) at the minimum demo size:
//   per market: lower caps, 5 USDG into the long pair, 0.01 stock into the short pair,
//   seed the margin pool with 5 USDG + $5 of stock, authorize and unpause the MarginRouter,
//   then set both markets to NORMAL. LeverageRouter, ShortRouter, AutoProtect and the vault
//   stay paused. Funds sent to the pairs cannot be withdrawn; the pool LP tokens can.
//
//   --plan    rehearses every transaction on a local fork of mainnet (no mainnet tx)
//   --run     broadcasts to mainnet; resumable from the journal
//   --verify  read-only checks of the opened markets
const require = createRequire(
  new URL("../apps/keeper/package.json", import.meta.url),
);
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const profile = ".env.mainnet.core.local";
const directory = ".secrets/rh-mainnet-enable";
const CHAIN_ID = 4663;
const STATUS_NORMAL = 0;
// Funding size per market. MAINNET_ENABLE_SIZE=micro (default, about $1.10 per market)
// or demo (about $18.50 per market). MAINNET_ENABLE_MARKETS limits the markets, e.g. "TSLA".
const SIZES = {
  micro: {
    longDebtLiquidity: 250000n, // 0.25 USDG (6 decimals)
    shortStockLiquidity: 10n ** 15n, // 0.001 stock (18 decimals)
    poolUsdg: 250000n, // 0.25 USDG, matched by the same USD value of stock
    caps: {
      long: { supply: 10n ** 16n, borrow: 250000n }, // 0.01 stock, 0.25 USDG
      short: { supply: 5_000000n, borrow: 10n ** 15n }, // 5 USDG, 0.001 stock
    },
  },
  demo: {
    longDebtLiquidity: 5_000000n,
    shortStockLiquidity: 10n ** 16n,
    poolUsdg: 5_000000n,
    caps: {
      long: { supply: 5n * 10n ** 16n, borrow: 5_000000n },
      short: { supply: 20_000000n, borrow: 10n ** 16n },
    },
  },
};
const SIZE_NAME = process.env.MAINNET_ENABLE_SIZE ?? "micro";
const SIZE = SIZES[SIZE_NAME];
if (!SIZE) throw Error("MAINNET_ENABLE_SIZE_MUST_BE_MICRO_OR_DEMO");
const LONG_DEBT_LIQUIDITY = SIZE.longDebtLiquidity;
const SHORT_STOCK_LIQUIDITY = SIZE.shortStockLiquidity;
const POOL_USDG = SIZE.poolUsdg;
const CAPS = SIZE.caps;

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
  if (existsSync(path))
    check((statSync(path).mode & 0o077) === 0, "PRIVATE_PATH_PERMISSIONS_REQUIRED");
}
const artifact = (name) =>
  JSON.parse(readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8")).abi;
const registryAbi = artifact("LevierMarketRegistry");
const marginAbi = artifact("MarginRouter");
const oracleAbi = artifact("VerifiedFeedOracle");

function loadProfile() {
  privateUntracked(profile);
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === "4663", "ROBINHOOD_MAINNET_REQUIRED");
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

// Deterministic list of owner transactions; stock pool amounts come from the oracle.
function buildOperations(record, config, poolStock, deadline) {
  const a = record.addresses;
  const usdg = config.oracle.stable.token;
  const ops = [];
  const call = (id, to, abi, functionName, args) =>
    ops.push({ id, to, data: v.encodeFunctionData({ abi, functionName, args }) });
  for (const m of config.markets) {
    const s = m.symbol.toLowerCase();
    const ids = record.markets[m.symbol];
    const router = a[`margin-${s}`];
    call(`${s}-caps-long`, a.registry, registryAbi, "updateCaps", [ids.longMarketId, CAPS.long.supply, CAPS.long.borrow]);
    call(`${s}-caps-short`, a.registry, registryAbi, "updateCaps", [ids.shortMarketId, CAPS.short.supply, CAPS.short.borrow]);
    call(`${s}-fund-long`, usdg, v.erc20Abi, "transfer", [a[`long-${s}`], LONG_DEBT_LIQUIDITY]);
    call(`${s}-fund-short`, m.token, v.erc20Abi, "transfer", [a[`short-${s}`], SHORT_STOCK_LIQUIDITY]);
    call(`${s}-approve-stock`, m.token, v.erc20Abi, "approve", [router, poolStock[m.symbol]]);
    call(`${s}-approve-usdg`, usdg, v.erc20Abi, "approve", [router, POOL_USDG]);
    call(`${s}-seed-pool`, router, marginAbi, "seedLiquidity", [poolStock[m.symbol], POOL_USDG, 1n, deadline]);
    call(`${s}-authorize-router`, a.registry, registryAbi, "setAuthorizedRouter", [router, true]);
    call(`${s}-unpause-router`, router, marginAbi, "setPaused", [false]);
    call(`${s}-open-long`, a.registry, registryAbi, "setMarketStatus", [ids.longMarketId, STATUS_NORMAL]);
    call(`${s}-open-short`, a.registry, registryAbi, "setMarketStatus", [ids.shortMarketId, STATUS_NORMAL]);
  }
  return ops;
}

function requiredFunds(config, poolStock) {
  const need = { USDG: 0n };
  for (const m of config.markets) {
    need.USDG += LONG_DEBT_LIQUIDITY + POOL_USDG;
    need[m.symbol] = SHORT_STOCK_LIQUIDITY + poolStock[m.symbol];
  }
  return need;
}

async function balances(client, config, owner) {
  const out = {
    USDG: await client.readContract({ address: config.oracle.stable.token, abi: v.erc20Abi, functionName: "balanceOf", args: [owner] }),
  };
  for (const m of config.markets)
    out[m.symbol] = await client.readContract({ address: m.token, abi: v.erc20Abi, functionName: "balanceOf", args: [owner] });
  return out;
}

async function verifyOpen(client, record, config) {
  const a = record.addresses;
  const result = {};
  for (const m of config.markets) {
    const s = m.symbol.toLowerCase();
    const ids = record.markets[m.symbol];
    const read = (address, abi, functionName, args = []) =>
      client.readContract({ address, abi, functionName, args });
    const long = await read(a.registry, registryAbi, "getMarket", [ids.longMarketId]);
    const short = await read(a.registry, registryAbi, "getMarket", [ids.shortMarketId]);
    const [stockReserve, stableReserve] = await read(a[`margin-${s}`], marginAbi, "reserves");
    check(long.status === STATUS_NORMAL && short.status === STATUS_NORMAL, `MARKET_NOT_OPEN_${s}`);
    check(long.borrowCap === CAPS.long.borrow && short.borrowCap === CAPS.short.borrow, `CAPS_MISMATCH_${s}`);
    check(await read(a.registry, registryAbi, "isAuthorizedRouter", [a[`margin-${s}`]]), `ROUTER_NOT_AUTHORIZED_${s}`);
    check(!(await read(a[`margin-${s}`], marginAbi, "isPaused")), `ROUTER_PAUSED_${s}`);
    check(stockReserve > 0n && stableReserve > 0n, `POOL_EMPTY_${s}`);
    result[m.symbol] = {
      longLiquidityUsdg: await read(config.oracle.stable.token, v.erc20Abi, "balanceOf", [a[`long-${s}`]]),
      shortLiquidityStock: await read(m.token, v.erc20Abi, "balanceOf", [a[`short-${s}`]]),
      poolStock: stockReserve,
      poolUsdg: stableReserve,
    };
  }
  for (const role of ["leverageRouter", "shortRouter", "autoProtect"])
    check(await client.readContract({ address: a[role], abi: artifact(role === "autoProtect" ? "AutoProtectModule" : role === "shortRouter" ? "ShortRouter" : "LeverageRouter"), functionName: "isPaused" }), `MUST_STAY_PAUSED_${role}`);
  return result;
}

// Fork-only helpers: start anvil and give the deployer test balances by writing ERC-20 storage.
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
async function dealToken(client, token, holder, amount) {
  const slots = [
    ...Array.from({ length: 12 }, (_, i) => v.toHex(i, { size: 32 })),
    "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00", // OpenZeppelin v5 ERC20 namespace
  ];
  for (const base of slots) {
    const slot = v.keccak256(v.encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [holder, base]));
    const before = await client.getStorageAt({ address: token, slot });
    await client.request({ method: "anvil_setStorageAt", params: [token, slot, v.toHex(amount, { size: 32 })] });
    const balance = await client.readContract({ address: token, abi: v.erc20Abi, functionName: "balanceOf", args: [holder] });
    if (balance === amount) return;
    await client.request({ method: "anvil_setStorageAt", params: [token, slot, before ?? v.toHex(0, { size: 32 })] });
  }
  // Proxied tokens keep balances behind the implementation's layout; fall back to impersonating a holder is not attempted.
  throw Error(`FORK_DEAL_FAILED_${token}`);
}

let release;
let stage = "configuration";
let fork;
try {
  const mode = process.argv[2];
  check(process.argv.length === 3 && ["--plan", "--run", "--verify"].includes(mode), "EXPLICIT_MODE_REQUIRED");
  const { env, account } = loadProfile();
  const record = JSON.parse(readFileSync("packages/contracts/deployments/mainnet-4663.json", "utf8"));
  const config = JSON.parse(readFileSync("scripts/mainnet-full-deploy.config.json", "utf8"));
  const only = (process.env.MAINNET_ENABLE_MARKETS ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (only.length) {
    check(only.every((x) => config.markets.some((m) => m.symbol === x)), "UNKNOWN_MARKET_IN_MAINNET_ENABLE_MARKETS");
    config.markets = config.markets.filter((m) => only.includes(m.symbol));
  }
  check(same(record.owner, account.address), "SIGNER_IS_NOT_PROTOCOL_OWNER");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const planPath = `${directory}/plan.json`;
  const statePath = `${directory}/state.json`;
  const main = clientsFor(env.RPC_URL, account);
  check((await main.client.getChainId()) === CHAIN_ID, "RPC_CHAIN_MISMATCH");

  if (mode === "--plan") {
    stage = "plan";
    check(!existsSync(statePath), "JOURNAL_EXISTS_RESUME_WITH_RUN");
    const poolStock = {};
    const prices = {};
    for (const m of config.markets) {
      const price = await main.client.readContract({ address: record.addresses.oracle, abi: oracleAbi, functionName: "getPrice", args: [m.token] });
      prices[m.symbol] = price;
      // Same USD value as POOL_USDG (6 decimals), converted at the oracle price (18 decimals).
      poolStock[m.symbol] = (POOL_USDG * 10n ** 12n * 10n ** BigInt(m.decimals)) / price;
    }
    const need = requiredFunds(config, poolStock);
    const have = await balances(main.client, config, account.address);
    const ethBalance = await main.client.getBalance({ address: account.address });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
    const ops = buildOperations(record, config, poolStock, deadline);

    stage = "fork-rehearsal";
    fork = await startFork(env.RPC_URL);
    const local = clientsFor(fork.url, account);
    await local.client.request({ method: "anvil_setBalance", params: [account.address, v.toHex(10n ** 18n)] });
    await dealToken(local.client, config.oracle.stable.token, account.address, need.USDG);
    for (const m of config.markets) await dealToken(local.client, m.token, account.address, need[m.symbol]);
    let gasUsed = 0n;
    for (const op of ops) {
      stage = `fork-${op.id}`;
      const hash = await local.wallet.sendTransaction({ to: op.to, data: op.data });
      const receipt = await local.client.waitForTransactionReceipt({ hash });
      check(receipt.status === "success", `FORK_REVERTED_${op.id}`);
      gasUsed += receipt.gasUsed;
    }
    stage = "fork-verify";
    const opened = await verifyOpen(local.client, record, config);
    fork.stop();
    fork = undefined;
    const gasPrice = await main.client.getGasPrice();
    const plan = {
      rehearsal: "PASSED",
      size: SIZE_NAME,
      markets: config.markets.map((m) => m.symbol),
      transactions: ops.length,
      deadline,
      poolStock,
      oraclePrices18: prices,
      requiredFunds: need,
      deployerBalances: have,
      shortfall: Object.fromEntries(Object.entries(need).map(([k, n]) => [k, have[k] >= n ? 0n : n - have[k]])),
      estimatedFeeEth: v.formatEther((gasUsed * gasPrice * 15n) / 10n),
      ethBalance: v.formatEther(ethBalance),
      openedOnFork: opened,
      operations: ops.map((op) => ({ id: op.id, to: op.to, dataHash: v.keccak256(op.data) })),
    };
    save(planPath, plan);
    log({
      rehearsal: "PASSED",
      transactions: ops.length,
      requiredFunds: need,
      deployerBalances: have,
      shortfall: plan.shortfall,
      estimatedFeeEth: plan.estimatedFeeEth,
      ethBalance: plan.ethBalance,
    });
  } else if (mode === "--run") {
    stage = "run";
    check(env.MAINNET_ENABLE_BROADCAST_ENABLED === "true", "MAINNET_BROADCAST_NOT_AUTHORIZED");
    check(existsSync(planPath), "PLAN_REQUIRED");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    check(plan.rehearsal === "PASSED", "PLAN_NOT_REHEARSED");
    check(plan.size === SIZE_NAME && json(plan.markets) === json(config.markets.map((m) => m.symbol)), "PLAN_SCOPE_CHANGED_REPLAN_REQUIRED");
    const poolStock = Object.fromEntries(Object.entries(plan.poolStock).map(([k, x]) => [k, BigInt(x)]));
    const ops = buildOperations(record, config, poolStock, BigInt(plan.deadline));
    check(
      ops.length === plan.operations.length &&
        ops.every((op, i) => op.id === plan.operations[i].id && v.keccak256(op.data) === plan.operations[i].dataHash),
      "PLAN_CHANGED_REPLAN_REQUIRED",
    );
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { operations: {} };
    const persist = () => save(statePath, state);
    if (!Object.keys(state.operations).length) {
      const need = requiredFunds(config, poolStock);
      const have = await balances(main.client, config, account.address);
      for (const [k, n] of Object.entries(need)) check(have[k] >= n, `INSUFFICIENT_${k}_BALANCE`);
    }
    const feeCap = BigInt(env.MAINNET_MAX_FEE_PER_GAS_WEI);
    for (const op of ops) {
      stage = `run-${op.id}`;
      const entry = state.operations[op.id];
      if (entry?.status === "success") continue;
      let hash = entry?.hash;
      if (!hash) {
        const [latest, pending] = await Promise.all(["latest", "pending"].map((blockTag) => main.client.getTransactionCount({ address: account.address, blockTag })));
        check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
        const gas = ((await main.client.estimateGas({ account: account.address, to: op.to, data: op.data })) * 13n) / 10n;
        const fees = await main.client.estimateFeesPerGas({ type: "eip1559" });
        check(fees.maxFeePerGas <= feeCap, "FEE_PER_GAS_LIMIT_EXCEEDED");
        hash = await main.wallet.sendTransaction({ to: op.to, data: op.data, gas, nonce: latest, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        state.operations[op.id] = { hash, status: "submitted" };
        persist();
        log({ stage: "submitted", id: op.id, hash });
      }
      const receipt = await main.client.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180000 });
      check(receipt.status === "success", `MAINNET_REVERTED_${op.id}`);
      state.operations[op.id] = { hash, status: "success" };
      persist();
      log({ stage: "confirmed", id: op.id, hash });
    }
    state.complete = true;
    persist();
    log({ stage: "run-complete", transactions: ops.length, next: "npm run rh:mainnet:markets:verify" });
  } else {
    stage = "verify";
    log({ stage: "verified", markets: await verifyOpen(main.client, record, config) });
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(json({ stage, error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : (error?.shortMessage ?? "ENABLE_MARKETS_FAILED_DETAILS_REDACTED") }));
  process.exitCode = 1;
} finally {
  if (release) release();
}
