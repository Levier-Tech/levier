import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { acquireLock } from "./lib/process-lock.mjs";

// Opens Pons leverage for one graduated token (MAINNET_PONS_OPEN=<symbol> from
// scripts/mainnet-pons-deploy.config.json "openMarkets"). Operations, all from the deployer (owner):
//   - oracle.listAsset + manager.setMarket for the token (2x, same caps as LEVIER)
//   - swap ETH to USDG on Uniswap v3 (USDG/WETH 0.01%), open vault deposits, deposit the seed
//   - poke the oracle every 4 minutes until the 30-minute TWAP is ready, then unpause opening
//   - optional smoke trade (--test): open a tiny 2x long, wait out the hold time, close it
//
//   --plan    rehearses everything on a local fork of mainnet (time is fast-forwarded)
//   --run     broadcasts to mainnet (needs MAINNET_PONS_OPEN_BROADCAST_ENABLED=true); resumable
//   --test    broadcasts the smoke trade (same flag); run after --run
//   --verify  read-only checks
const require = createRequire(new URL("../apps/keeper/package.json", import.meta.url));
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const profile = ".env.mainnet.core.local";
const configPath = "scripts/mainnet-pons-deploy.config.json";
const recordPath = "packages/contracts/deployments/mainnet-4663.json";
const CHAIN_ID = 4663;
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const SWAP_ETH = 400000000000000n; // 0.0004 ETH
const TEST_RESERVE = 300000n; // 0.30 USDG kept for the smoke trade
const TEST_COLLATERAL = 150000n; // 0.15 USDG at 2x = 0.30 notional
const POKES = 9;
const POKE_SPACING_S = 245;

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const json = (value) => JSON.stringify(value, (_, x) => (typeof x === "bigint" ? String(x) : x), 2);
const log = (value) => console.log(json(value));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function save(path, value) {
  writeFileSync(`${path}.tmp`, `${json(value)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function privateUntracked(path) {
  execFileSync("git", ["check-ignore", "-q", path], { stdio: "pipe" });
  if (existsSync(path)) check((statSync(path).mode & 0o077) === 0, "PRIVATE_PATH_PERMISSIONS_REQUIRED");
}
const abi = (name) => JSON.parse(readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8")).abi;
const quoterAbi = v.parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const routerAbi = v.parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
]);

function loadProfile() {
  privateUntracked(profile);
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(env.NETWORK_MODE === "MAINNET" && env.CHAIN_ID === String(CHAIN_ID), "ROBINHOOD_MAINNET_REQUIRED");
  check(new URL(env.RPC_URL).protocol === "https:", "HTTPS_RPC_REQUIRED");
  const account = privateKeyToAccount(env.PRIVATE_KEY);
  check(account.address.toLowerCase() === env.DEPLOYER_ADDRESS.toLowerCase(), "SIGNER_IDENTITY_MISMATCH");
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
  return { client: v.createPublicClient({ chain, transport, cacheTime: 0 }), wallet: v.createWalletClient({ account, chain, transport }) };
}

// Each step: { id, build(ctx) -> {to, data, value?} | null (skip), wait?: seconds before sending }
function steps(record, config, m) {
  const p = record.pons.addresses;
  const oracle = abi("PonsV4TwapOracle"),
    manager = abi("PonsPerpManager"),
    vault = abi("PonsLiquidityVault");
  const usdg = config.usdg;
  const list = [
    {
      id: `list-${m.symbol.toLowerCase()}`,
      build: async ({ client }) =>
        (await client.readContract({ address: p.ponsOracle, abi: oracle, functionName: "assets", args: [m.token] }))[0] !== v.zeroHash
          ? null
          : { to: p.ponsOracle, data: v.encodeFunctionData({ abi: oracle, functionName: "listAsset", args: [m.token] }) },
    },
    {
      id: `set-market-${m.symbol.toLowerCase()}`,
      build: async ({ client }) =>
        (await client.readContract({ address: p.ponsManager, abi: manager, functionName: "markets", args: [m.token] }))[0]
          ? null
          : {
              to: p.ponsManager,
              data: v.encodeFunctionData({
                abi: manager,
                functionName: "setMarket",
                args: [m.token, m.maxLeverageBps, m.maintenanceMarginBps, BigInt(m.maxPositionSizeRaw), BigInt(m.maxOpenInterestRaw)],
              }),
            },
    },
    {
      id: "swap-eth-usdg",
      build: async ({ client, account }) => {
        const { result } = await client.simulateContract({
          address: QUOTER,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn: WETH, tokenOut: usdg, amountIn: SWAP_ETH, fee: 100, sqrtPriceLimitX96: 0n }],
        });
        const minOut = (result[0] * 99n) / 100n;
        check(minOut > TEST_RESERVE * 2n, "SWAP_OUTPUT_TOO_SMALL");
        return {
          to: ROUTER,
          value: SWAP_ETH,
          data: v.encodeFunctionData({
            abi: routerAbi,
            functionName: "exactInputSingle",
            args: [{ tokenIn: WETH, tokenOut: usdg, fee: 100, recipient: account.address, amountIn: SWAP_ETH, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
          }),
        };
      },
    },
    {
      id: "open-vault-deposits",
      build: async ({ client }) =>
        (await client.readContract({ address: p.ponsVault, abi: vault, functionName: "depositsPaused" }))
          ? { to: p.ponsVault, data: v.encodeFunctionData({ abi: vault, functionName: "setDepositsPaused", args: [false] }) }
          : null,
    },
    {
      id: "approve-vault-seed",
      build: async () => ({ to: usdg, data: v.encodeFunctionData({ abi: v.erc20Abi, functionName: "approve", args: [p.ponsVault, v.maxUint256] }) }),
    },
    {
      id: "deposit-seed",
      build: async ({ client, account }) => {
        const balance = await client.readContract({ address: usdg, abi: v.erc20Abi, functionName: "balanceOf", args: [account.address] });
        check(balance > TEST_RESERVE + 500000n, "USDG_SEED_TOO_SMALL");
        return { to: p.ponsVault, data: v.encodeFunctionData({ abi: vault, functionName: "deposit", args: [balance - TEST_RESERVE, account.address] }) };
      },
    },
  ];
  for (let i = 1; i <= POKES; i++)
    list.push({
      id: `poke-${i}`,
      wait: i === 1 ? 0 : POKE_SPACING_S,
      build: async () => ({ to: p.ponsOracle, data: v.encodeFunctionData({ abi: oracle, functionName: "poke", args: [m.token] }) }),
    });
  list.push({
    id: "check-twap-ready",
    build: async ({ client }) => {
      await client.readContract({ address: p.ponsOracle, abi: oracle, functionName: "peek", args: [m.token] });
      return null; // read-only gate: reverts with TwapNotReady/PriceDeviation if not ready
    },
  });
  list.push({
    id: "unpause-opening",
    build: async ({ client }) =>
      (await client.readContract({ address: p.ponsManager, abi: manager, functionName: "openingPaused" }))
        ? { to: p.ponsManager, data: v.encodeFunctionData({ abi: manager, functionName: "setOpeningPaused", args: [false] }) }
        : null,
  });
  return list;
}

function testSteps(record, config, m) {
  const p = record.pons.addresses;
  const manager = abi("PonsPerpManager");
  return [
    { id: "approve-manager", build: async () => ({ to: config.usdg, data: v.encodeFunctionData({ abi: v.erc20Abi, functionName: "approve", args: [p.ponsManager, TEST_COLLATERAL] }) }) },
    { id: "test-open-long", build: async () => ({ to: p.ponsManager, data: v.encodeFunctionData({ abi: manager, functionName: "openPosition", args: [m.token, true, TEST_COLLATERAL, 20000n] }) }) },
    {
      id: "test-close",
      wait: 310,
      build: async ({ client, account }) => {
        const ids = await client.readContract({ address: p.ponsManager, abi: manager, functionName: "positionsOf", args: [account.address] });
        check(ids.length > 0, "NO_TEST_POSITION");
        return { to: p.ponsManager, data: v.encodeFunctionData({ abi: manager, functionName: "closePosition", args: [ids[ids.length - 1]] }) };
      },
    },
  ];
}

async function execute(ctx, list, state, persist, { fork, feeCap }) {
  for (const step of list) {
    const entry = state[step.id];
    if (entry?.status === "success" || entry?.status === "skipped") continue;
    let hash = entry?.hash;
    if (!hash) {
      if (step.wait) {
        if (fork) await ctx.client.request({ method: "evm_increaseTime", params: [v.toHex(step.wait)] });
        else {
          const since = Math.floor(Date.now() / 1000) - (state.lastSentAt ?? 0);
          if (since < step.wait) {
            log({ stage: "waiting", next: step.id, seconds: step.wait - since });
            await sleep((step.wait - since) * 1000);
          }
        }
      }
      const tx = await step.build(ctx);
      if (!tx) {
        state[step.id] = { status: "skipped" };
        persist();
        log({ stage: "skipped", id: step.id });
        continue;
      }
      const [latest, pending] = await Promise.all(["latest", "pending"].map((blockTag) => ctx.client.getTransactionCount({ address: ctx.account.address, blockTag })));
      check(latest === pending, "SIGNER_HAS_PENDING_TRANSACTION");
      // The fork mirrors mainnet fees so the rehearsal also proves the deployer's ETH covers the run.
      if (fork) await ctx.client.request({ method: "anvil_setNextBlockBaseFeePerGas", params: [v.toHex(fork.baseFee)] });
      const gas = ((await ctx.client.estimateGas({ account: ctx.account.address, ...tx })) * 13n) / 10n;
      const fees = fork
        ? { maxFeePerGas: fork.baseFee * 2n, maxPriorityFeePerGas: 0n }
        : await ctx.client.estimateFeesPerGas({ type: "eip1559" });
      if (feeCap) check(fees.maxFeePerGas <= feeCap, "FEE_PER_GAS_LIMIT_EXCEEDED");
      hash = await ctx.wallet.sendTransaction({ ...tx, gas, nonce: latest, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      state[step.id] = { hash, status: "submitted" };
      persist();
      log({ stage: "submitted", id: step.id, hash });
    }
    const receipt = await ctx.client.waitForTransactionReceipt({ hash, timeout: 180000 });
    check(receipt.status === "success", `REVERTED_${step.id}`);
    if (fork) fork.spent += receipt.gasUsed * receipt.effectiveGasPrice;
    state[step.id] = { hash, status: "success" };
    state.lastSentAt = Math.floor(Date.now() / 1000);
    persist();
    log({ stage: "confirmed", id: step.id, hash });
  }
}

async function report(client, record, config, m, account) {
  const p = record.pons.addresses;
  const read = (address, a, functionName, args = []) => client.readContract({ address, abi: abi(a), functionName, args });
  const [spotUsd, twapUsd] = await read(p.ponsOracle, "PonsV4TwapOracle", "peek", [m.token]);
  return {
    market: m.symbol,
    spotUsd: v.formatUnits(spotUsd, 18),
    twapUsd: v.formatUnits(twapUsd, 18),
    openingPaused: await read(p.ponsManager, "PonsPerpManager", "openingPaused"),
    depositsPaused: await read(p.ponsVault, "PonsLiquidityVault", "depositsPaused"),
    vaultUsdg: v.formatUnits(await read(p.ponsVault, "PonsLiquidityVault", "totalAssets"), 6),
    reserved: v.formatUnits(await read(p.ponsVault, "PonsLiquidityVault", "reserved"), 6),
    deployerUsdg: v.formatUnits(await client.readContract({ address: config.usdg, abi: v.erc20Abi, functionName: "balanceOf", args: [account.address] }), 6),
    deployerEth: v.formatEther(await client.getBalance({ address: account.address })),
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
    await sleep(500);
  }
  anvil.kill("SIGTERM");
  throw Error("ANVIL_FORK_DID_NOT_START");
}

let release;
let stage = "configuration";
let fork;
try {
  const mode = process.argv[2];
  check(process.argv.length === 3 && ["--plan", "--run", "--test", "--verify"].includes(mode), "EXPLICIT_MODE_REQUIRED");
  const symbol = (process.env.MAINNET_PONS_OPEN ?? "").trim().toUpperCase();
  const { env, account } = loadProfile();
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const m = (config.openMarkets ?? []).find((x) => x.symbol === symbol);
  check(m && record.pons, "MARKET_NOT_IN_CONFIG");
  check(record.owner.toLowerCase() === account.address.toLowerCase(), "SIGNER_IS_NOT_PROTOCOL_OWNER");
  const directory = `.secrets/rh-mainnet-pons-open-${symbol.toLowerCase()}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privateUntracked(directory);
  release = acquireLock(`${directory}/operations.lock`);
  const statePath = `${directory}/state.json`;
  const main = clientsFor(env.RPC_URL, account);
  check((await main.client.getChainId()) === CHAIN_ID, "RPC_CHAIN_MISMATCH");
  const feeCap = BigInt(env.MAINNET_MAX_FEE_PER_GAS_WEI);

  if (mode === "--plan") {
    stage = "fork-rehearsal";
    fork = await startFork(env.RPC_URL);
    const local = clientsFor(fork.url, account);
    const ctx = { ...local, account };
    const state = {};
    const block = await main.client.getBlock();
    const forkFees = { baseFee: block.baseFeePerGas, spent: 0n };
    await execute(ctx, steps(record, config, m), state, () => {}, { fork: forkFees });
    stage = "fork-test-trade";
    await execute(ctx, testSteps(record, config, m), state, () => {}, { fork: forkFees });
    const checked = await report(local.client, record, config, m, account);
    fork.stop();
    fork = undefined;
    const plan = { rehearsal: "PASSED", market: symbol, gasFeesEth: v.formatEther(forkFees.spent), steps: Object.keys(state).filter((k) => k !== "lastSentAt").length, afterOnFork: checked };
    save(`${directory}/plan.json`, plan);
    log(plan);
  } else if (mode === "--run" || mode === "--test") {
    stage = mode.slice(2);
    check(env.MAINNET_PONS_OPEN_BROADCAST_ENABLED === "true", "MAINNET_BROADCAST_NOT_AUTHORIZED");
    check(existsSync(`${directory}/plan.json`), "PLAN_REQUIRED");
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
    const persist = () => save(statePath, state);
    const ctx = { ...main, account };
    if (mode === "--run") await execute(ctx, steps(record, config, m), state, persist, { fork: false, feeCap });
    else await execute(ctx, testSteps(record, config, m), state, persist, { fork: false, feeCap });
    log({ stage: `${stage}-complete`, ...(await report(main.client, record, config, m, account)) });
  } else {
    stage = "verify";
    log({ stage: "verified", ...(await report(main.client, record, config, m, account)) });
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(json({ stage, error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : (error?.shortMessage ?? "PONS_OPEN_FAILED_DETAILS_REDACTED") }));
  process.exitCode = 1;
} finally {
  if (release) release();
}
