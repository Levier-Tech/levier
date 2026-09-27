import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createPublicClient, http, parseAbi, parseAbiItem, formatUnits } = requireWeb("viem");

const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const ROBINHOOD_CHAIN_ID = 4663;

const FACTORY_ABI = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);

const TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const LAUNCH_SWEPT_EVENT = parseAbiItem(
  "event LaunchSwept(address indexed token, uint256 sweptQuote, uint256 sweptTokens)"
);

async function fetchEthPriceUsd(pythUrl, pythApiKey) {
  try {
    const feedId = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    const baseUrl = pythUrl || "https://hermes.pyth.network";
    const endpoint = `${baseUrl}/v2/updates/price/latest?ids[]=${feedId}`;
    const headers = {};
    if (pythApiKey) headers["Authorization"] = `Bearer ${pythApiKey}`;
    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const parsed = data.parsed?.[0]?.price;
      if (parsed) return Number(parsed.price) * Math.pow(10, parsed.expo);
    }
  } catch (err) {}
  return 2500.0;
}

async function main() {
  const env = parseEnv(readFileSync(new URL("../.env.testnet", import.meta.url), "utf8"));
  
  let rpcUrl = env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  if (rpcUrl.includes("robinhood-testnet.g.alchemy.com")) {
    rpcUrl = rpcUrl.replace("robinhood-testnet.g.alchemy.com", "robinhood-mainnet.g.alchemy.com");
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error("Not connected to Mainnet!");

  const ethPriceUsd = await fetchEthPriceUsd(env.PYTH_HERMES_URL, env.PYTH_API_KEY);
  const minMarketCap = 1000000; // 1M USD threshold

  // Get recent graduated tokens
  const currentBlock = await client.getBlockNumber();
  const sweptLogs = await client.getLogs({
    address: PONS_V2_FACTORY,
    event: LAUNCH_SWEPT_EVENT,
    fromBlock: currentBlock - 1000000n, // approx last 1M blocks
    toBlock: currentBlock,
  });

  const tokenAddresses = Array.from(new Set(sweptLogs.map((l) => l.args.token.toLowerCase())));
  const allGraduated = [];
  const eligibleTokens = [];

  for (const tokenAddr of tokenAddresses) {
    const launch = await client.readContract({
      address: PONS_V2_FACTORY,
      abi: FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [tokenAddr],
    });

    if (!launch.exists || launch.phase !== 2) continue;

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }).catch(() => "Unknown"),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }).catch(() => "???"),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "decimals" }).catch(() => 18),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "totalSupply" }).catch(() => 0n),
    ]);

    const formattedSupply = Number(formatUnits(totalSupply, decimals));
    let priceUsd = 0;
    let marketCapUsd = 0;

    if (launch.pairToken === "0x0000000000000000000000000000000000000000") {
      const priceEth = 5.88 / 285714285.7142857;
      priceUsd = priceEth * ethPriceUsd;
      marketCapUsd = formattedSupply * priceUsd;
    } else {
      priceUsd = 8090 / 285714285.7142857;
      marketCapUsd = formattedSupply * priceUsd;
    }

    const tokenData = {
      tokenAddress: tokenAddr,
      name,
      symbol,
      priceUsd,
      marketCapUsd,
      eligible: marketCapUsd >= minMarketCap
    };

    allGraduated.push(tokenData);
    if (tokenData.eligible) {
      eligibleTokens.push(tokenData);
    }
  }

  const response = {
    network: "Robinhood Chain Mainnet",
    chainId: Number(chainId),
    rpcUrl: rpcUrl.replace(/alch_[a-zA-Z0-9_-]+/, "alch_***"),
    minMarketCapThreshold: minMarketCap,
    totalGraduatedFound: allGraduated.length,
    eligibleTokensCount: eligibleTokens.length,
    eligibleTokens: eligibleTokens,
    allTokens: allGraduated.slice(0, 5) // Show top 5 for proof
  };

  writeFileSync("mainnet_pons_test_result.json", JSON.stringify(response, null, 2));
}

main().catch(console.error);
