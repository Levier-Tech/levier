import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

// Buys, with the deployer's ETH, the tokens the micro market opening needs, through the
// official Uniswap v3 deployment on Robinhood Chain (factory 0x1f7d…2EfA, SwapRouter02,
// QuoterV2, from the Uniswap SDK address book). Every swap is exact-output with at most 1%
// slippage over a fresh quote. Steps whose target balance is already met are skipped, so the
// script is safe to re-run after an interruption.
//
//   --plan  quotes on mainnet and rehearses every swap on a local fork (no mainnet tx)
//   --run   broadcasts the swaps to mainnet (needs MAINNET_SWAP_BROADCAST_ENABLED=true)
const require = createRequire(new URL("../apps/keeper/package.json", import.meta.url));
const v = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const CHAIN_ID = 4663;
const profile = ".env.mainnet.core.local";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
// Fee tier of the deepest Uniswap v3 stock/USDG pool per market.
const STOCK_FEES = { TSLA: 3000, AMZN: 3000, PLTR: 3000, AMD: 3000, NVDA: 500 };
// MAINNET_BUY_MARKETS selects the markets (default: the four launch markets), e.g. "NVDA".
const ALL_MARKETS = JSON.parse(readFileSync("scripts/mainnet-full-deploy.config.json", "utf8")).markets;
const selected = (process.env.MAINNET_BUY_MARKETS ?? "TSLA,AMZN,PLTR,AMD").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const STOCKS = selected.map((symbol) => {
  const m = ALL_MARKETS.find((x) => x.symbol === symbol);
  if (!m || !STOCK_FEES[symbol]) throw Error("UNKNOWN_MARKET_IN_MAINNET_BUY_MARKETS");
  return { symbol, token: m.token, fee: STOCK_FEES[symbol] };
});
const USDG_FEE = 100; // USDG/WETH 0.01% pool, the deepest on the chain
const SLIPPAGE_BPS = 100n;
// Micro opening needs per market: 0.001 stock for the short pair plus $0.25 of stock for the pool,
// and 0.25 + 0.25 USDG, plus 0.05 USDG spare. A 5% buffer on stock covers price moves before the opening.
const USDG_FOR_MARKETS = BigInt(STOCKS.length) * 500000n + 50000n;
const STOCK_USD_FOR_POOL = 0.25;
const STOCK_FOR_SHORT = 0.001;
const BUFFER = 1.05;

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const fmt = (x, d) => v.formatUnits(x, d);
const quoterAbi = v.parseAbi([
  "function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const routerAbi = v.parseAbi([
  "function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)",
  "function refundETH() payable",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
]);
const oracleAbi = v.parseAbi(["function getPrice(address) view returns (uint256)"]);

function loadProfile() {
  execFileSync("git", ["check-ignore", "-q", profile], { stdio: "pipe" });
  check((statSync(profile).mode & 0o077) === 0, "PROFILE_REQUIRES_MODE_0600");
  const env = parseEnv(readFileSync(profile, "utf8"));
  check(env.CHAIN_ID === String(CHAIN_ID), "ROBINHOOD_MAINNET_REQUIRED");
  const account = privateKeyToAccount(env.PRIVATE_KEY);
  check(account.address.toLowerCase() === env.DEPLOYER_ADDRESS.toLowerCase(), "SIGNER_IDENTITY_MISMATCH");
  return { env, account };
}
function clients(url, account) {
  const chain = v.defineChain({
    id: CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  const transport = v.http(url, { timeout: 60000, retryCount: 1 });
  return {
    client: v.createPublicClient({ chain, transport, cacheTime: 0 }),
    wallet: v.createWalletClient({ account, chain, transport }),
  };
}
const balanceOf = (client, token, owner) =>
  client.readContract({ address: token, abi: v.erc20Abi, functionName: "balanceOf", args: [owner] });
const quoteIn = async (client, tokenIn, tokenOut, amount, fee) =>
  (await client.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactOutputSingle",
    args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
  })).result[0];
const withSlippage = (x) => (x * (10000n + SLIPPAGE_BPS)) / 10000n;

// Stock targets from the v2 oracle, so the amounts match what the market opening will ask for.
async function targets(client) {
  const record = JSON.parse(readFileSync("packages/contracts/deployments/mainnet-4663.json", "utf8"));
  const out = {};
  for (const s of STOCKS) {
    const price = Number(v.formatUnits(
      await client.readContract({ address: record.addresses.oracle, abi: oracleAbi, functionName: "getPrice", args: [s.token] }),
      18,
    ));
    out[s.symbol] = v.parseUnits(((STOCK_FOR_SHORT + STOCK_USD_FOR_POOL / price) * BUFFER).toFixed(18), 18);
  }
  return out;
}

// Runs the purchase against one chain (fork or mainnet). Idempotent per step.
async function buy({ client, wallet }, owner, need, log) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const missing = {};
  for (const s of STOCKS) {
    const have = await balanceOf(client, s.token, owner);
    missing[s.symbol] = have >= need[s.symbol] ? 0n : need[s.symbol] - have;
  }
  // USDG needed: the markets' own USDG plus the input of every remaining stock swap.
  let usdgNeeded = USDG_FOR_MARKETS;
  const stockQuotes = {};
  for (const s of STOCKS) {
    if (!missing[s.symbol]) continue;
    stockQuotes[s.symbol] = withSlippage(await quoteIn(client, USDG, s.token, missing[s.symbol], s.fee));
    usdgNeeded += stockQuotes[s.symbol];
  }
  const usdgHave = await balanceOf(client, USDG, owner);
  if (usdgHave < usdgNeeded) {
    const amountOut = usdgNeeded - usdgHave;
    const maxIn = withSlippage(await quoteIn(client, WETH, USDG, amountOut, USDG_FEE));
    const calls = [
      v.encodeFunctionData({
        abi: routerAbi,
        functionName: "exactOutputSingle",
        args: [{ tokenIn: WETH, tokenOut: USDG, fee: USDG_FEE, recipient: owner, amountOut, amountInMaximum: maxIn, sqrtPriceLimitX96: 0n }],
      }),
      v.encodeFunctionData({ abi: routerAbi, functionName: "refundETH" }),
    ];
    const hash = await wallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "multicall", args: [deadline, calls], value: maxIn });
    check((await client.waitForTransactionReceipt({ hash })).status === "success", "SWAP_ETH_TO_USDG_FAILED");
    log({ step: "ETH->USDG", usdg: fmt(amountOut, 6), maxEth: fmt(maxIn, 18), hash });
  } else log({ step: "ETH->USDG", skipped: "USDG already sufficient" });

  const totalStockIn = Object.values(stockQuotes).reduce((a, b) => a + b, 0n);
  if (totalStockIn > 0n) {
    const allowance = await client.readContract({ address: USDG, abi: v.erc20Abi, functionName: "allowance", args: [owner, ROUTER] });
    if (allowance < totalStockIn) {
      const hash = await wallet.writeContract({ address: USDG, abi: v.erc20Abi, functionName: "approve", args: [ROUTER, totalStockIn] });
      check((await client.waitForTransactionReceipt({ hash })).status === "success", "APPROVE_USDG_FAILED");
      log({ step: "approve USDG", amount: fmt(totalStockIn, 6), hash });
    }
  }
  for (const s of STOCKS) {
    if (!missing[s.symbol]) {
      log({ step: `USDG->${s.symbol}`, skipped: "already sufficient" });
      continue;
    }
    const call = v.encodeFunctionData({
      abi: routerAbi,
      functionName: "exactOutputSingle",
      args: [{ tokenIn: USDG, tokenOut: s.token, fee: s.fee, recipient: owner, amountOut: missing[s.symbol], amountInMaximum: stockQuotes[s.symbol], sqrtPriceLimitX96: 0n }],
    });
    const hash = await wallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "multicall", args: [deadline, [call]] });
    check((await client.waitForTransactionReceipt({ hash })).status === "success", `SWAP_USDG_TO_${s.symbol}_FAILED`);
    log({ step: `USDG->${s.symbol}`, amount: fmt(missing[s.symbol], 18), maxUsdg: fmt(stockQuotes[s.symbol], 6), hash });
  }
  const final = { ETH: fmt(await client.getBalance({ address: owner }), 18), USDG: fmt(await balanceOf(client, USDG, owner), 6) };
  for (const s of STOCKS) final[s.symbol] = fmt(await balanceOf(client, s.token, owner), 18);
  check((await balanceOf(client, USDG, owner)) >= USDG_FOR_MARKETS, "USDG_TARGET_NOT_MET");
  for (const s of STOCKS) check((await balanceOf(client, s.token, owner)) >= need[s.symbol], `${s.symbol}_TARGET_NOT_MET`);
  return final;
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

let fork;
try {
  const mode = process.argv[2];
  check(process.argv.length === 3 && ["--plan", "--run"].includes(mode), "EXPLICIT_MODE_REQUIRED");
  const { env, account } = loadProfile();
  const main = clients(env.RPC_URL, account);
  check((await main.client.getChainId()) === CHAIN_ID, "RPC_CHAIN_MISMATCH");
  check(
    (await main.client.readContract({ address: ROUTER, abi: routerAbi, functionName: "factory" })).toLowerCase() === FACTORY.toLowerCase() &&
      (await main.client.readContract({ address: ROUTER, abi: routerAbi, functionName: "WETH9" })).toLowerCase() === WETH.toLowerCase(),
    "UNISWAP_ROUTER_IDENTITY_MISMATCH",
  );
  const need = await targets(main.client);
  const log = (x) => console.log(JSON.stringify(x));
  const ethBefore = await main.client.getBalance({ address: account.address });
  console.log(`Deployer ${account.address}: ${fmt(ethBefore, 18)} ETH`);
  console.log(`Targets: USDG ${fmt(USDG_FOR_MARKETS, 6)}, ` + STOCKS.map((s) => `${s.symbol} ${fmt(need[s.symbol], 18)}`).join(", "));
  if (mode === "--plan") {
    fork = await startFork(env.RPC_URL);
    const final = await buy(clients(fork.url, account), account.address, need, (x) => log({ fork: true, ...x }));
    fork.stop();
    fork = undefined;
    const spent = ethBefore - v.parseEther(final.ETH);
    console.log(JSON.stringify({ rehearsal: "PASSED", ethSpentOnFork: fmt(spent, 18), ethLeftOnFork: final.ETH, balancesOnFork: final }, null, 2));
  } else {
    check(env.MAINNET_SWAP_BROADCAST_ENABLED === "true", "MAINNET_BROADCAST_NOT_AUTHORIZED");
    const final = await buy(main, account.address, need, log);
    console.log(JSON.stringify({ stage: "bought", ethSpent: fmt(ethBefore - v.parseEther(final.ETH), 18), balances: final }, null, 2));
  }
} catch (error) {
  if (fork) fork.stop();
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ error: /^[A-Z][A-Z0-9_]+$/.test(message) ? message : (error?.shortMessage ?? "BUY_TOKENS_FAILED_DETAILS_REDACTED") }));
  process.exitCode = 1;
}
