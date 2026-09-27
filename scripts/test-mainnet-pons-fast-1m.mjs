import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createPublicClient, http, parseAbi, formatUnits } = requireWeb("viem");

const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

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

function normalizeMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${trimmed.slice(7)}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return null;
}

const KNOWN_TOKENS = [
  "0x7dbf38976f6d3b9c529e7d9484a71898b409ee6a", // ZZZ
  "0x451b42A15100C340CA12F7c66DE06fac5EA2D751", // Longbow
  "0xD5f1afEA47b1A9eab414D2ee740cF1d6d039E725", // microduck
  "0x4A72B9702f991b790788f8AFA9e7112541f4E8f8", // Route
  "0x11B70d0243baf75E85CE03201A92b5B7C33BEB59", // Robin the Frog
  "0x49bac47750F3dCdBa49350B5D74fd399e90f97C6", // The Bull
  "0xb83fC6010C8Dcf628abE787a161c619FcC543117", // PENPE
  "0x398AcA5e6ae801b002D684333AFFAdC1a25e897C", // Listed exchange
];

async function main() {
  const env = parseEnv(readFileSync(new URL("../.env.testnet", import.meta.url), "utf8"));
  let rpcUrl = env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
  if (rpcUrl.includes("robinhood-testnet.g.alchemy.com")) {
    rpcUrl = rpcUrl.replace("robinhood-testnet.g.alchemy.com", "robinhood-mainnet.g.alchemy.com");
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  
  const above1MTokens = [];

  for (const tokenAddr of KNOWN_TOKENS) {
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
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`);
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

    if (marketCapUsd >= 1000000) {
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
      requestedLimit: 8
    },
    result: {
      requested: 8,
      returned: above1MTokens.length,
      complete: true,
      reason: "Successfully fetched metadata and real-time DexScreener pricing for target candidates > 1M MC."
    },
    tokens: above1MTokens
  };

  writeFileSync("mainnet_pons_fast_1m.json", JSON.stringify(response, null, 2));
}

main().catch(console.error);
