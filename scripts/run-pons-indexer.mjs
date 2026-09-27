import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { connectIndexerDatabase } from "./lib/rh-indexer-store.mjs";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createPublicClient, http, parseAbi, parseAbiItem, formatUnits } = requireWeb("viem");

const PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const MEME_HOOK = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
const ROBINHOOD_CHAIN_ID = 4663;

const FACTORY_ABI = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function launchConfigCount() view returns (uint256)",
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

/**
 * Format IPFS URI into a public gateway URL so it can be loaded in web browsers.
 */
function normalizeMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice(7);
    return `https://gateway.pinata.cloud/ipfs/${path}`;
  }
  // Handle bare CID (starts with Qm or bafy)
  if (/^(Qm[a-zA-Z0-9]{44}|bafy[a-zA-Z0-9]+)/.test(trimmed)) {
    return `https://gateway.pinata.cloud/ipfs/${trimmed}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return null;
}

/**
 * Fetch reference ETH/USD price from Pyth Hermes oracle feed or fallback.
 */
async function fetchEthPriceUsd(pythUrl, pythApiKey) {
  try {
    const feedId = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"; // ETH/USD
    const baseUrl = pythUrl || "https://hermes.pyth.network";
    const endpoint = `${baseUrl}/v2/updates/price/latest?ids[]=${feedId}`;
    const headers = {};
    if (pythApiKey) {
      headers["Authorization"] = `Bearer ${pythApiKey}`;
    }
    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const parsed = data.parsed?.[0]?.price;
      if (parsed) {
        return Number(parsed.price) * Math.pow(10, parsed.expo);
      }
    }
  } catch (err) {
    console.warn(`[PonsIndexer] Pyth ETH price fetch failed: ${err.message}. Using default reference.`);
  }
  return 2500.0; // Standard fallback
}

/**
 * Syncs on-chain Pons tokens into Supabase PostgreSQL.
 */
async function syncPonsTokens(client, sql, env, fromBlock, toBlock) {
  console.log(`\n[PonsIndexer] Scanning LaunchSwept events from block ${fromBlock} to ${toBlock}...`);

  const sweptLogs = await client.getLogs({
    address: PONS_V2_FACTORY,
    event: LAUNCH_SWEPT_EVENT,
    fromBlock,
    toBlock,
  });

  console.log(`[PonsIndexer] Found ${sweptLogs.length} LaunchSwept events in range.`);

  // Deduplicate candidate addresses
  const tokenAddresses = Array.from(new Set(sweptLogs.map((l) => l.args.token.toLowerCase())));
  
  // If in incremental mode and no new events found, check existing graduated tokens for price refresh
  if (tokenAddresses.length === 0) {
    const existing = await sql`SELECT token_address FROM pons_tokens WHERE chain_id = ${ROBINHOOD_CHAIN_ID} AND graduation_phase = 2`;
    for (const r of existing) {
      tokenAddresses.push(r.token_address.toLowerCase());
    }
    console.log(`[PonsIndexer] Reconciling prices for ${tokenAddresses.length} existing graduated tokens.`);
  }

  const ethPriceUsd = await fetchEthPriceUsd(env.PYTH_HERMES_URL, env.PYTH_API_KEY);
  // Only tokens with market cap above $800K are eligible
  const minMarketCap = 1000000; // Strictly minimum $1M MC

  const graduatedTokens = [];

  for (const tokenAddr of tokenAddresses) {
    try {
      const launch = await client.readContract({
        address: PONS_V2_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getLaunchedToken",
        args: [tokenAddr],
      });

      if (!launch.exists || launch.phase !== 2) {
        continue;
      }

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
      let dexScreenerLogo = null;

      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (dexRes.ok) {
          const data = await dexRes.json();
          if (data.pairs && data.pairs.length > 0) {
            // Sort by liquidity to get the most accurate pool
            const bestPair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            if (bestPair && bestPair.priceUsd) {
              priceUsd = parseFloat(bestPair.priceUsd);
              marketCapUsd = parseFloat(bestPair.marketCap) || (formattedSupply * priceUsd);
            }
            // Extract DexScreener logo as fallback
            if (bestPair?.info?.imageUrl) {
              dexScreenerLogo = bestPair.info.imageUrl;
            }
          }
        }
      } catch (err) {
        console.warn(`[PonsIndexer] Failed to fetch DexScreener for ${symbol}:`, err.message);
      }

      // Use DexScreener logo if on-chain logo is empty or IPFS-based (slower)
      const finalLogo = dexScreenerLogo || logoUrl;

      // Fallback to graduation price if DexScreener fails or has no pairs yet
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

      // Graduated + market cap above $800K threshold
      const isEligible = launch.phase === 2 && marketCapUsd >= minMarketCap;

      graduatedTokens.push({
        tokenAddress: tokenAddr,
        name,
        symbol,
        decimals,
        totalSupply: formattedSupply,
        logoUrl: finalLogo,
        description,
        websiteUrl: socials?.website || null,
        twitterUrl: socials?.twitter || null,
        telegramUrl: socials?.telegram || null,
        discordUrl: socials?.discord || null,
        farcasterUrl: socials?.farcaster || null,
        pairToken: launch.pairToken,
        phase: launch.phase,
        priceUsd,
        marketCapUsd,
        eligible: isEligible,
      });
    } catch (err) {
      console.error(`[PonsIndexer] Error querying token ${tokenAddr}: ${err.message}`);
    }
  }

  for (const t of graduatedTokens) {
    await sql`
      INSERT INTO pons_tokens (
        chain_id, token_address, name, symbol, logo_url,
        description, website_url, twitter_url, telegram_url, discord_url,
        pons_generation, factory_address, pons_verified, graduation_status, graduation_phase,
        token_price_usd, circulating_supply, market_cap_usd, fdv_usd, eligible, market_data_updated_at
      ) VALUES (
        ${ROBINHOOD_CHAIN_ID}, ${t.tokenAddress.toLowerCase()}, ${t.name}, ${t.symbol}, ${t.logoUrl},
        ${t.description}, ${t.websiteUrl}, ${t.twitterUrl}, ${t.telegramUrl}, ${t.discordUrl},
        'v2', ${PONS_V2_FACTORY}, true, 'GRADUATED', ${t.phase},
        ${t.priceUsd}, ${t.totalSupply}, ${t.marketCapUsd}, ${t.marketCapUsd}, ${t.eligible}, NOW()
      )
      ON CONFLICT (chain_id, token_address) DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        logo_url = EXCLUDED.logo_url,
        description = EXCLUDED.description,
        website_url = EXCLUDED.website_url,
        twitter_url = EXCLUDED.twitter_url,
        telegram_url = EXCLUDED.telegram_url,
        discord_url = EXCLUDED.discord_url,
        pons_verified = true,
        graduation_status = 'GRADUATED',
        graduation_phase = EXCLUDED.graduation_phase,
        token_price_usd = EXCLUDED.token_price_usd,
        circulating_supply = EXCLUDED.circulating_supply,
        market_cap_usd = EXCLUDED.market_cap_usd,
        fdv_usd = EXCLUDED.fdv_usd,
        eligible = EXCLUDED.eligible,
        market_data_updated_at = NOW(),
        updated_at = NOW()
    `;

    // Record history snapshot for chart display
    await sql`
      INSERT INTO pons_market_history (
        token_address, chain_id, price_usd, market_cap_usd, recorded_at
      ) VALUES (
        ${t.tokenAddress.toLowerCase()}, ${ROBINHOOD_CHAIN_ID}, ${t.priceUsd}, ${t.marketCapUsd}, NOW()
      )
    `;
  }

  console.log(`[PonsIndexer] Successfully synced ${graduatedTokens.length} tokens into database.`);
}

export async function main(args) {
  const [mode, profile] = args;

  if (!["--migrate", "--sync", "--serve", "--clean"].includes(mode) || !profile) {
    throw new Error("Usage: node run-pons-indexer.mjs <--migrate|--sync|--serve|--clean> <env_file>");
  }

  const env = profile === "--runtime" ? process.env : parseEnv(readFileSync(profile, "utf8"));

  const sql = connectIndexerDatabase({
    ...env,
    DATABASE_SSL_CA_PATH: env.DATABASE_SSL_CA_PATH
      ? resolve(profile === "--runtime" ? process.cwd() : dirname(profile), env.DATABASE_SSL_CA_PATH)
      : undefined,
  });

  try {
    // Check DB connection
    await sql`select 1`;

    if (mode === "--migrate") {
      console.log("Running Pons tokens migration...");
      const migration = readFileSync(
        new URL("../supabase/migrations/20260918000001_pons_tokens_discovery.sql", import.meta.url),
        "utf8"
      );

      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('pons-discovery-migration',0))`;
        await tx.unsafe(migration);
      });

      console.log("Migration successful.");
      return;
    }

    if (mode === "--clean") {
      console.log("Cleaning mock and outdated Pons token records...");
      await sql`TRUNCATE TABLE pons_market_history CASCADE`;
      await sql`TRUNCATE TABLE pons_tokens CASCADE`;
      console.log("Cleaned pons_tokens and pons_market_history.");
      return;
    }

    if (mode === "--sync" || mode === "--serve") {
      console.log(`Starting Pure On-Chain Pons Indexer [Mode: ${mode}]...`);

      let rpcUrl = env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
      if (rpcUrl.includes("robinhood-testnet.g.alchemy.com")) {
        rpcUrl = rpcUrl.replace("robinhood-testnet.g.alchemy.com", "robinhood-mainnet.g.alchemy.com");
      }

      console.log(`Connecting to RPC: ${rpcUrl.replace(/alch_[a-zA-Z0-9_-]+/, "alch_***")}`);

      const client = createPublicClient({
        transport: http(rpcUrl, { retryCount: 3, timeout: 20000 }),
      });

      const chainId = await client.getChainId();
      if (chainId !== ROBINHOOD_CHAIN_ID) {
        throw new Error(`RPC Chain ID mismatch. Expected ${ROBINHOOD_CHAIN_ID}, got ${chainId}`);
      }

      const factoryCode = await client.getBytecode({ address: PONS_V2_FACTORY });
      if (!factoryCode || factoryCode === "0x") {
        throw new Error(`Pons V2 Factory not found at ${PONS_V2_FACTORY}`);
      }

      let running = true;
      const stop = () => {
        console.log("\n[PonsIndexer] Gracefully shutting down indexer service...");
        running = false;
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);

      const pollIntervalMs = Number(env.PONS_INDEXER_POLL_INTERVAL_MS || 5000);
      let lastScannedBlock = null;

      do {
        const currentBlock = await client.getBlockNumber();
        // Increase initial scan window to 5 million blocks to guarantee all historical V2 tokens are fetched
        const scanWindow = 5000000n;
        const fromBlock = lastScannedBlock
          ? lastScannedBlock + 1n
          : (currentBlock > scanWindow ? currentBlock - scanWindow : 0n);

        if (fromBlock <= currentBlock) {
          // Chunk large block ranges to prevent RPC payload too large errors
          const MAX_CHUNK = 200000n;
          let toBlock = currentBlock;
          if (toBlock - fromBlock > MAX_CHUNK) {
            toBlock = fromBlock + MAX_CHUNK;
          }

          await syncPonsTokens(client, sql, env, fromBlock, toBlock);
          lastScannedBlock = toBlock;
        } else {
          console.log(`[PonsIndexer] Already caught up to block ${currentBlock}.`);
        }

        if (mode !== "--serve" || !running) break;

        console.log(`[PonsIndexer] Next poll in ${pollIntervalMs / 1000}s. Press Ctrl+C to stop.`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } while (running);

      console.log("[PonsIndexer] Indexer loop completed.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("Fatal Pons indexer error:", err);
    process.exit(1);
  });
}
