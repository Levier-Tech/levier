import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectIndexerDatabase } from "./lib/rh-indexer-store.mjs";

async function main() {
  const profile = new URL("../apps/web/.env", import.meta.url).pathname; // use the web env where DB connection lives
  // Wait, the indexer was run with .env.testnet
  const envFile = new URL("../.env.testnet", import.meta.url).pathname;
  const env = parseEnv(readFileSync(envFile, "utf8"));

  const sql = connectIndexerDatabase({
    ...env,
    DATABASE_SSL_CA_PATH: env.DATABASE_SSL_CA_PATH
      ? resolve(dirname(envFile), env.DATABASE_SSL_CA_PATH)
      : undefined,
  });

  try {
    const data = JSON.parse(readFileSync("mainnet_pons_fast_1m.json", "utf8"));
    const tokens = data.tokens;
    
    console.log(`Inserting ${tokens.length} tokens into Postgres...`);
    const ROBINHOOD_CHAIN_ID = 4663;
    const PONS_V2_FACTORY = data.pons.factoryV2;

    for (const t of tokens) {
      await sql`
        INSERT INTO pons_tokens (
          chain_id, token_address, name, symbol, logo_url,
          description, website_url, twitter_url, telegram_url, discord_url,
          pons_generation, factory_address, pons_verified, graduation_status, graduation_phase,
          token_price_usd, circulating_supply, market_cap_usd, fdv_usd, eligible, market_data_updated_at
        ) VALUES (
          ${ROBINHOOD_CHAIN_ID}, ${t.address.toLowerCase()}, ${t.name}, ${t.symbol}, ${t.logo_url},
          ${t.description}, ${t.website_url}, ${t.twitter_url}, ${t.telegram_url}, ${t.discord_url},
          'v2', ${PONS_V2_FACTORY}, true, 'GRADUATED', 2,
          ${t.priceUsd}, ${t.supply}, ${t.marketCapUsd}, ${t.marketCapUsd}, ${t.eligibleByMarketCap}, NOW()
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

      await sql`
        INSERT INTO pons_market_history (
          token_address, chain_id, price_usd, market_cap_usd, recorded_at
        ) VALUES (
          ${t.address.toLowerCase()}, ${ROBINHOOD_CHAIN_ID}, ${t.priceUsd}, ${t.marketCapUsd}, NOW()
        )
      `;
      console.log(`Inserted ${t.symbol} ($${t.marketCapUsd})`);
    }

    console.log("Database insertion complete!");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(console.error);
