import {
  fetchJson,
  validateReference,
  type QuotePolicy,
  type HttpPolicy,
} from "../../../price-oracle/src/services/robinhoodQuoteService";
import { referencePricesSchema } from "./reference-prices";
export async function readReferencePrices(
  baseUrl: string,
  identities: { symbol: string; chainId: number; address: string }[],
  policy: QuotePolicy & HttpPolicy,
  fetcher: typeof fetchJson,
) {
  let assets: unknown;
  try {
    assets = await fetcher(new URL("assets", baseUrl), policy);
  } catch {
    assets = null;
  }
  const prices = await Promise.all(
    identities.map(async (identity) => {
      try {
        if (!assets) throw Error();
        const response = await fetcher(
          new URL(`prices/${encodeURIComponent(identity.symbol)}`, baseUrl),
          policy,
        );
        const quote = validateReference(
          assets,
          response,
          identity,
          policy,
          Date.now(),
        );
        // This is underlying-stock reference pricing, not a testnet-token valuation
        // or permission to trade. Do not apply a token multiplier to this label.
        return {
          symbol: identity.symbol,
          quote: {
            mid18: String((BigInt(quote.bid18) + BigInt(quote.ask18)) / 2n),
            generatedAt: quote.generatedAt,
          },
        };
      } catch {
        return { symbol: identity.symbol, quote: null };
      }
    }),
  );
  return referencePricesSchema.parse({
    capturedAt: new Date().toISOString(),
    source: "Robinhood stock reference",
    maxAgeMs: policy.maxAgeMs,
    prices,
  });
}
