import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import environment from "../apps/web/config/environment.cjs";
import { readPythReferencePrices } from "../apps/web/src/lib/read-pyth-reference-prices.ts";
import { readReferencePrices } from "../apps/web/src/lib/read-reference-prices.ts";
import {
  fetchRobinhoodJson,
  parseRobinhoodTransport,
} from "../apps/price-oracle/src/services/robinhoodTransport.ts";
const catalog = JSON.parse(readFileSync("data/asset-catalog.json", "utf8"));
try {
  if (
    process.argv.length !== 3 ||
    !["apps/web/.env", "--runtime"].includes(process.argv[2])
  )
    throw Error();
  const raw =
    process.argv[2] === "--runtime"
      ? process.env
      : parseEnv(readFileSync(process.argv[2], "utf8"));
  const server = environment.validate(environment.serverSchema, raw);
  const client = environment.validate(environment.clientSchema, raw);
  const statuses = new Map();
  const transport = parseRobinhoodTransport(server.ROBINHOOD_TRANSPORT_JSON);
  const data =
    server.REFERENCE_PRICE_PROVIDER === "PYTH"
      ? await readPythReferencePrices(
          server.PYTH_HERMES_URL,
          server.PYTH_API_KEY,
          server.PYTH_FEEDS_JSON,
          {
            ...server.REFERENCE_PRICE_POLICY_JSON,
            maxConfidenceBps: server.PYTH_MAX_CONFIDENCE_BPS,
            batchSize: server.PYTH_REQUEST_BATCH_SIZE,
          },
          async (input, options) => {
            const response = await fetch(input, options);
            for (const id of new URL(String(input)).searchParams.getAll(
              "ids[]",
            )) {
              const symbol = Object.keys(server.PYTH_FEEDS_JSON).find(
                (s) => server.PYTH_FEEDS_JSON[s].id === id,
              );
              if (symbol) statuses.set(symbol, response.status);
            }
            return response;
          },
        )
      : await readReferencePrices(
          server.ROBINHOOD_STOCK_API_URL,
          catalog.map((x) => ({
            symbol: x.ticker,
            chainId: client.CHAIN_ID,
            address: client.PROTOCOL_ADDRESSES.tokens[x.ticker],
          })),
          server.REFERENCE_PRICE_POLICY_JSON,
          async (url, policy) => {
            const result = await fetchRobinhoodJson(url, policy, transport);
            if (url.pathname.includes("/prices/"))
              statuses.set(url.pathname.split("/").at(-1), 200);
            return result;
          },
        );
  const ready = data.prices.every((row) => row.quote !== null);
  console.log(
    JSON.stringify(
      {
        capturedAt: data.capturedAt,
        source: data.source,
        ...(server.REFERENCE_PRICE_PROVIDER === "PYTH"
          ? { keyConfigured: server.PYTH_API_KEY.length > 0 }
          : { transportMode: transport.mode, tlsVerificationEnabled: true }),
        allReferencePricesFresh: ready,
        markets: data.prices.map((row) => ({
          symbol: row.symbol,
          httpStatus: statuses.get(row.symbol) ?? null,
          fresh: row.quote !== null,
          publishedAt: row.quote?.generatedAt ?? null,
        })),
        note: "Display-reference check only; does not activate or attest to any onchain oracle, lending or margin market.",
      },
      null,
      2,
    ),
  );
  if (!ready) process.exitCode = 2;
} catch {
  console.error(
    "Reference-price check failed; configuration/provider details redacted.",
  );
  process.exitCode = 1;
}
