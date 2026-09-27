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
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
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
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error("Not connected to Mainnet!");

  const ethPriceUsd = await fetchEthPriceUsd(env.PYTH_HERMES_URL, env.PYTH_API_KEY);
  const minMarketCap = 1000000;

  // Let's specifically check the Bounty token from the user's tip, plus a recent blocks scan.
  const knownTokens = ["0xf25cbd487fe0294dd0a39ba2955982bcff28fd72"]; 
  
  const currentBlock = await client.getBlockNumber();
  const sweptLogs = await client.getLogs({
    address: PONS_V2_FACTORY,
    event: LAUNCH_SWEPT_EVENT,
    fromBlock: currentBlock - 2000000n, // Increase range to catch more
    toBlock: currentBlock,
  });

  const tokenAddresses = Array.from(new Set([
    ...knownTokens,
    ...sweptLogs.map((l) => l.args.token.toLowerCase())
  ]));

  const allTokensData = [];
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

    let tokenInfo = null;
    try {
      tokenInfo = await client.readContract({
        address: tokenAddr,
        abi: TOKEN_ABI,
        functionName: "getTokenInfo",
      });
    } catch (e) {}

    const rawLogo = tokenInfo ? tokenInfo[1] : null;
    const logoUrl = normalizeMediaUrl(rawLogo);
    const description = tokenInfo ? tokenInfo[2] : null;
    const socials = tokenInfo ? tokenInfo[3] : {};
    
    const formattedSupply = Number(formatUnits(totalSupply, decimals));
    let priceUsd = 0;
    let marketCapUsd = 0;

    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, {
        signal: AbortSignal.timeout(5000)
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

    // Fallback if not indexed by DexScreener yet
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

    const isEligible = marketCapUsd >= minMarketCap;

    const dbRecord = {
      chain_id: Number(chainId),
      token_address: tokenAddr,
      name,
      symbol,
      logo_url: logoUrl,
      description,
      website_url: socials?.website || null,
      twitter_url: socials?.twitter || null,
      telegram_url: socials?.telegram || null,
      discord_url: socials?.discord || null,
      pons_generation: 'v2',
      factory_address: PONS_V2_FACTORY,
      pons_verified: true,
      graduation_status: 'GRADUATED',
      graduation_phase: launch.phase,
      token_price_usd: priceUsd,
      circulating_supply: formattedSupply,
      market_cap_usd: marketCapUsd,
      fdv_usd: marketCapUsd,
      eligible: isEligible
    };

    allTokensData.push(dbRecord);
    if (isEligible) {
      eligibleTokens.push(dbRecord);
    }
  }

  const response = {
    network: "Robinhood Chain Mainnet",
    chainId: Number(chainId),
    rpcUrl: rpcUrl.replace(/alch_[a-zA-Z0-9_-]+/, "alch_***"),
    minMarketCapThresholdUsd: minMarketCap,
    totalGraduatedFound: allTokensData.length,
    eligibleTokensCount: eligibleTokens.length,
    eligibleTokens: eligibleTokens,
    allTokensSample: allTokensData.slice(0, 5)
  };

  writeFileSync("mainnet_pons_test_full.json", JSON.stringify(response, null, 2));
  console.log(`Test complete. Found ${allTokensData.length} tokens, ${eligibleTokens.length} eligible.`);
}

main().catch(console.error);
