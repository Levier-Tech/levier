import { z } from "zod";
import {
  fetchJson,
  type HttpPolicy,
} from "../../../price-oracle/src/services/robinhoodQuoteService";
import { referencePricesSchema } from "./reference-prices";

type Feed = { id: string; symbol: string };
type Policy = HttpPolicy & {
  maxAgeMs: number;
  maxConfidenceBps: number;
  batchSize: number;
};
const priceSchema = z.object({
  price: z
    .string()
    .max(78)
    .regex(/^[1-9]\d*$/),
  conf: z
    .string()
    .max(78)
    .regex(/^(0|[1-9]\d*)$/),
  expo: z.number().int().min(-18).max(18),
  publish_time: z
    .number()
    .int()
    .positive()
    .max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
});
const payloadSchema = z.object({
  parsed: z
    .array(
      z.object({
        id: z.string().regex(/^(?:0x)?[0-9a-f]{64}$/),
        price: z.unknown(),
      }),
    )
    .max(100),
});

/** HTTPS reference quotes for display only. Not signed oracle reports or token valuations. */
export async function readPythReferencePrices(
  baseUrl: string,
  apiKey: string,
  feeds: Record<string, Feed>,
  policy: Policy,
  fetcher: typeof fetch = fetch,
) {
  const entries = Object.entries(feeds);
  let payload: z.infer<typeof payloadSchema> | null = null;
  try {
    if (
      baseUrl !== "https://pyth.dourolabs.app/hermes/" ||
      !/^\S+$/.test(apiKey)
    )
      throw Error();
    if (
      !Number.isSafeInteger(policy.maxAgeMs) ||
      policy.maxAgeMs <= 0 ||
      !Number.isSafeInteger(policy.maxConfidenceBps) ||
      policy.maxConfidenceBps <= 0 ||
      policy.maxConfidenceBps > 100 ||
      !Number.isSafeInteger(policy.batchSize) ||
      policy.batchSize < 1 ||
      policy.batchSize > 5
    )
      throw Error();
    if (
      !entries.length ||
      new Set(entries.map(([, feed]) => feed.id)).size !== entries.length ||
      entries.some(
        ([symbol, feed]) =>
          !/^[A-Z0-9]+$/.test(symbol) ||
          !/^[0-9a-f]{64}$/.test(feed.id) ||
          feed.symbol !== `Equity.US.${symbol}/USD`,
      )
    )
      throw Error();
    const groups: (typeof entries)[] = [];
    for (let index = 0; index < entries.length; index += policy.batchSize)
      groups.push(entries.slice(index, index + policy.batchSize));
    // A denied feed must not suppress accessible feeds in other configured groups.
    // No retries against another provider or unconfigured source.
    const results = await Promise.all(
      groups.map(async (group) => {
        try {
          const url = new URL("v2/updates/price/latest", baseUrl);
          for (const [, feed] of group)
            url.searchParams.append("ids[]", feed.id);
          url.searchParams.set("parsed", "true");
          const result = await fetchJson(url, policy, (input, options) =>
            fetcher(input, {
              ...options,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
            }),
          );
          const rows = payloadSchema.parse(result).parsed;
          const requestedIds = new Set(group.map(([, feed]) => feed.id));
          // A response cannot inject a price into a different request group.
          return rows.filter((row) =>
            requestedIds.has(row.id.replace(/^0x/, "")),
          );
        } catch {
          return [];
        }
      }),
    );
    payload = { parsed: results.flat() };
  } catch {
    // Never echo provider errors, headers, binary updates or credentials to the browser.
    payload = null;
  }
  const now = Date.now();
  return referencePricesSchema.parse({
    capturedAt: new Date(now).toISOString(),
    source: "Pyth stock reference",
    maxAgeMs: policy.maxAgeMs,
    prices: entries.map(([symbol, feed]) => {
      try {
        const matches = payload?.parsed.filter(
          (row) => row.id.replace(/^0x/, "") === feed.id,
        );
        if (matches?.length !== 1) throw Error();
        const price = priceSchema.parse(matches[0].price);
        const age = now - price.publish_time * 1000;
        if (age < 0 || age > policy.maxAgeMs) throw Error();
        const value = BigInt(price.price);
        if (
          BigInt(price.conf) * 10000n >
          value * BigInt(policy.maxConfidenceBps)
        )
          throw Error();
        const mid18 = value * 10n ** BigInt(18 + price.expo);
        if (mid18 <= 0n || mid18 > (1n << 256n) - 1n) throw Error();
        return {
          symbol,
          quote: {
            mid18: String(mid18),
            generatedAt: new Date(price.publish_time * 1000).toISOString(),
          },
        };
      } catch {
        return { symbol, quote: null };
      }
    }),
  });
}
