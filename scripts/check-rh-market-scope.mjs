import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readMarketScope } from "./lib/rh-market-scope.mjs";
import { readAnalyticsSnapshot } from "../apps/web/src/lib/analytics.ts";
const requireWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { createPublicClient, http, erc20Abi, formatUnits } = requireWeb("viem");
try {
  const [profile, output] = process.argv.slice(2);
  if (profile !== ".env.testnet" || !output) throw Error();
  const env = parseEnv(readFileSync(profile, "utf8")),
    scope = readMarketScope(env);
  const timeout = Number(env.RPC_TIMEOUT_MS),
    maxAge = Number(env.ANALYTICS_MAX_BLOCK_AGE_SECONDS);
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    !Number.isSafeInteger(maxAge) ||
    maxAge < 1
  )
    throw Error();
  const client = createPublicClient({
    transport: http(env.RPC_URL, { timeout, retryCount: 0 }),
    cacheTime: 0,
  });
  if ((await client.getChainId()) !== Number(env.CHAIN_ID)) throw Error();
  const blockNumber = await client.getBlockNumber(),
    block = await client.getBlock({ blockNumber });
  const age = () => Math.floor(Date.now() / 1000) - Number(block.timestamp);
  if (!block.hash || age() < 0 || age() > maxAge) throw Error();
  const markets = [];
  for (const row of scope) {
    let tokenObservation = null,
      deployedObservation = null;
    if (row.token)
      try {
        const code = await client.getCode({ address: row.token, blockNumber });
        if (!code || code === "0x") throw Error();
        const [symbol, decimals, deployer, tester] = await Promise.all([
          client.readContract({
            address: row.token,
            abi: erc20Abi,
            functionName: "symbol",
            blockNumber,
          }),
          client.readContract({
            address: row.token,
            abi: erc20Abi,
            functionName: "decimals",
            blockNumber,
          }),
          client.readContract({
            address: row.token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [env.DEPLOYER_ADDRESS],
            blockNumber,
          }),
          client.readContract({
            address: row.token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [env.TESTER_ADDRESS],
            blockNumber,
          }),
        ]);
        if (symbol !== row.symbol || decimals > 36) throw Error();
        tokenObservation = {
          symbolMatches: true,
          decimals,
          deployerBalance: formatUnits(deployer, decimals),
          testerBalance: formatUnits(tester, decimals),
        };
      } catch {
        /* Unknown observations never become zero. */
      }
    if (row.long && row.margin)
      try {
        const snapshot = await readAnalyticsSnapshot(
          client,
          [
            { label: `${row.symbol} Long`, deployment: row.long },
            { label: `${row.symbol} Short`, deployment: row.margin.short },
          ],
          Number(env.LENDING_RECEIPT_CONFIRMATIONS),
          { deployment: row.margin, long: row.long },
          maxAge,
        );
        deployedObservation = {
          block: snapshot.blockNumber,
          verifiedPairs: snapshot.totals.verifiedMarkets,
          freshPrices: snapshot.markets.every(
            (x) =>
              x.metrics?.collateralPrice18 != null &&
              x.metrics?.debtPrice18 != null,
          ),
          poolVerified: snapshot.pool?.reserves != null,
        };
      } catch {
        /* Keep deployment verification failure explicit. */
      }
    markets.push({
      symbol: row.symbol,
      tokenConfigured: row.token !== null,
      tokenObservation,
      tokenSourceConfigured: row.tokenSourceConfigured,
      referenceBindingConfigured: row.referenceBindingConfigured,
      longConfigured: row.long !== null,
      marginConfigured: row.margin !== null,
      deployedObservation,
    });
  }
  if (
    (await client.getBlock({ blockNumber })).hash !== block.hash ||
    age() < 0 ||
    age() > maxAge
  )
    throw Error();
  const report = {
    capturedAt: new Date().toISOString(),
    chainId: Number(env.CHAIN_ID),
    inventoryBlock: String(blockNumber),
    targetMarkets: scope.length,
    markets,
    allMarketsAccepted: false,
    transactionsSubmitted: 0,
    note: "Preparation inventory only. Source fields are not provenance acceptance; deployments need price/liquidity/transaction acceptance. Missing observations are not zero. Deployment snapshots identify their own confirmed block.",
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "market-scope.json"), text, { flag: "wx" });
  console.log(text);
} catch {
  console.error(
    "Market scope check unavailable; inspect required RH_<SYMBOL>_* fields and RPC health. Values redacted.",
  );
  process.exitCode = 1;
}
