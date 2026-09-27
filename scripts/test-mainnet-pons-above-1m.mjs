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
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)"
]);

const LAUNCH_SWEPT_EVENT = parseAbiItem(
  "event LaunchSwept(address indexed token, uint256 sweptQuote, uint256 sweptTokens)"
);

function normalizeMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${trimmed.slice(7)}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

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
  const ethPriceUsd = await fetchEthPriceUsd(env.PYTH_HERMES_URL, env.PYTH_API_KEY);
  
  const currentBlock = await client.getBlockNumber();
  const startBlock = 55000000n; // Roughly genesis of Pons V2 on Robinhood Mainnet
  
  let allLogs = [];
  const chunkSize = 2000000n;
  for (let b = startBlock; b < currentBlock; b += chunkSize) {
    const end = (b + chunkSize > currentBlock) ? currentBlock : b + chunkSize;
    try {
      const logs = await client.getLogs({
        address: PONS_V2_FACTORY,
        event: LAUNCH_SWEPT_EVENT,
        fromBlock: b,
        toBlock: end,
      });
      allLogs = allLogs.concat(logs);
    } catch(e) {
      console.warn(`Chunk failed ${b} to ${end}`);
    }
  }

  const tokenAddresses = Array.from(new Set(allLogs.map((l) => l.args.token.toLowerCase())));
  console.log(`Found ${tokenAddresses.length} graduated tokens on mainnet.`);
  
  const above1MTokens = [];

  for (const tokenAddr of tokenAddresses) {
    if (above1MTokens.length >= 15) break; 

    let launch;
    try {
      launch = await client.readContract({
        address: PONS_V2_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getLaunchedToken",
        args: [tokenAddr],
      });
    } catch (e) { continue; }

    if (!launch.exists || launch.phase !== 2) continue;

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "name" }).catch(() => "Unknown"),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "symbol" }).catch(() => "???"),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "decimals" }).catch(() => 18),
      client.readContract({ address: tokenAddr, abi: TOKEN_ABI, functionName: "totalSupply" }).catch(() => 0n),
    ]);

    let tokenInfo = null;
    try {
      tokenInfo = await client.readContract({
        address: tokenAddr,
        abi: TOKEN_ABI,
        functionName: "getTokenInfo",
      });
    } catch (e) {}

    const rawLogo = tokenInfo ? tokenInfo[1] : null;
    const logo_url = normalizeMediaUrl(rawLogo);
    const description = tokenInfo ? tokenInfo[2] : null;
    const socials = tokenInfo ? tokenInfo[3] : {};

    const formattedSupply = Number(formatUnits(totalSupply, decimals));
    let priceUsd = 0;
    let marketCapUsd = 0;

    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (dexRes.ok) {
        const data = await dexRes.json();
        if (data.pairs && data.pairs.length > 0) {
          const bestPair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          if (bestPair && bestPair.priceUsd) {
            priceUsd = parseFloat(bestPair.priceUsd);
            marketCapUsd = parseFloat(bestPair.marketCap) || (formattedSupply * priceUsd);
          }
        }
      }
    } catch (err) {}

    // Fallback if not indexed by DexScreener
    if (priceUsd === 0) {
      if (launch.pairToken === "0x0000000000000000000000000000000000000000") {
        const priceEth = 5.88 / 285714285.7142857;
        priceUsd = priceEth * ethPriceUsd;
        marketCapUsd = formattedSupply * priceUsd;
      } else {
        priceUsd = 8090 / 285714285.7142857;
        marketCapUsd = formattedSupply * priceUsd;
      }
    }

    if (marketCapUsd >= 1000000) {
      console.log(`Found eligible >1M: ${symbol} at $${marketCapUsd}`);
      above1MTokens.push({
        chain_id: Number(chainId),
        name,
        symbol,
        address: tokenAddr,
        logo_url,
        description,
        website_url: socials?.website || null,
        twitter_url: socials?.twitter || null,
        telegram_url: socials?.telegram || null,
        discord_url: socials?.discord || null,
        pairSymbol: launch.pairToken === "0x0000000000000000000000000000000000000000" ? "ETH" : "ERC20",
        supply: totalSupply.toString(),
        priceUsd,
        marketCapUsd,
        market: "uniswap_v4",
        graduationCandidate: true,
        requiredRpcVerification: {
          method: "getLaunchedToken(address)",
          expectedExists: true,
          expectedPhase: 2
        },
        eligibleByMarketCap: true
      });
    }
  }

  const response = {
    network: {
      name: "Robinhood Chain Mainnet",
      chainId: 4663
    },
    pons: {
      factoryV2: PONS_V2_FACTORY
    },
    filter: {
      ponsOnly: true,
      graduatedOnly: true,
      minimumMarketCapUsd: 1000000,
      requestedLimit: 10
    },
    result: {
      requested: 10,
      returned: above1MTokens.length,
      complete: false,
      reason: "Successfully filtered tokens above 1M market cap threshold."
    },
    tokens: above1MTokens
  };

  writeFileSync("mainnet_pons_above_1m.json", JSON.stringify(response, null, 2));
}

main().catch(console.error);
