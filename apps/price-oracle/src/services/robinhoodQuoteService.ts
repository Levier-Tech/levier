import { z } from "zod";
import { fetchJson, QuoteError, type HttpPolicy } from "./boundedHttp.js";
import {
  fetchRobinhoodJson,
  type RobinhoodTransport,
} from "./robinhoodTransport.js";
export { fetchJson, QuoteError, type HttpPolicy } from "./boundedHttp.js";

const decimal = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/);
const deployment = z.object({
  chainId: z.number().int().positive(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const assetSchema = z.object({
  tokenSymbol: z.string(),
  currentMultiplier: decimal,
  pendingMultiplier: z.string(),
  status: z.string(),
  deployments: z.array(deployment),
});
const quoteSchema = z.object({
  tokenSymbol: z.string(),
  bid: decimal,
  ask: decimal,
  currency: z.literal("USD"),
  isTradingHalt: z.boolean(),
  generatedAt: z.string().datetime({ offset: true }),
  deployments: z.array(deployment),
});
const SCALE = 10n ** 18n;
const UINT256_MAX = (1n << 256n) - 1n;
export type QuotePolicy = {
  maxAgeMs: number;
  maxFutureSkewMs: number;
  maxSpreadBps: number;
};
export type TokenIdentity = {
  symbol: string;
  chainId: number;
  address: string;
};
export type ReferenceQuote = {
  symbol: string;
  bid18: string;
  ask18: string;
  multiplier18: string;
  generatedAt: string;
  observedAt: string;
  ageMs: number;
  assetDeploymentMatches: boolean;
  quoteDeploymentMatches: boolean;
};
export function decimal18(value: string): bigint {
  if (!decimal.safeParse(value).success)
    throw new QuoteError("INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
  if (n <= 0n || n > UINT256_MAX) throw new QuoteError("INVALID_PRICE_RANGE");
  return n;
}
export function validateReference(
  assetPayload: unknown,
  quotePayload: unknown,
  identity: TokenIdentity,
  policy: QuotePolicy,
  nowMs: number,
): ReferenceQuote {
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0 ||
    !Number.isSafeInteger(policy.maxFutureSkewMs) ||
    policy.maxFutureSkewMs < 0 ||
    !Number.isSafeInteger(policy.maxSpreadBps) ||
    policy.maxSpreadBps <= 0 ||
    policy.maxSpreadBps > 10000
  )
    throw new QuoteError("INVALID_POLICY");
  const assets = z
    .object({ assets: z.array(assetSchema) })
    .safeParse(assetPayload);
  const quotes = z
    .object({ quotes: z.array(quoteSchema) })
    .safeParse(quotePayload);
  if (!assets.success || !quotes.success)
    throw new QuoteError("INVALID_RESPONSE");
  const matchingAssets = assets.data.assets.filter(
    (a) => a.tokenSymbol === identity.symbol,
  );
  const matchingQuotes = quotes.data.quotes.filter(
    (q) => q.tokenSymbol === identity.symbol,
  );
  if (matchingAssets.length !== 1 || matchingQuotes.length !== 1)
    throw new QuoteError("AMBIGUOUS_OR_MISSING_SYMBOL");
  const asset = matchingAssets[0],
    quote = matchingQuotes[0];
  if (asset.status !== "ASSET_STATUS_ACTIVE")
    throw new QuoteError("ASSET_INACTIVE");
  if (asset.pendingMultiplier !== "")
    throw new QuoteError("CORPORATE_ACTION_PENDING");
  if (quote.isTradingHalt) throw new QuoteError("TRADING_HALTED");
  const ageMs = nowMs - Date.parse(quote.generatedAt);
  if (!Number.isFinite(ageMs) || ageMs > policy.maxAgeMs)
    throw new QuoteError("STALE_QUOTE");
  if (ageMs < -policy.maxFutureSkewMs) throw new QuoteError("FUTURE_QUOTE");
  const bid = decimal18(quote.bid),
    ask = decimal18(quote.ask),
    multiplier = decimal18(asset.currentMultiplier);
  if (ask < bid) throw new QuoteError("CROSSED_QUOTE");
  if ((ask - bid) * 10000n > bid * BigInt(policy.maxSpreadBps))
    throw new QuoteError("SPREAD_TOO_WIDE");
  const matches = (entries: z.infer<typeof deployment>[]) =>
    entries.filter(
      (d) =>
        d.chainId === identity.chainId &&
        d.contractAddress.toLowerCase() === identity.address.toLowerCase(),
    ).length === 1;
  return {
    symbol: identity.symbol,
    bid18: String(bid),
    ask18: String(ask),
    multiplier18: String(multiplier),
    generatedAt: quote.generatedAt,
    observedAt: new Date(nowMs).toISOString(),
    ageMs,
    assetDeploymentMatches: matches(asset.deployments),
    quoteDeploymentMatches: matches(quote.deployments),
  };
}
/** Only matched deployment metadata may be converted into a token valuation; never a ticker-only association. */
export function tokenValuation(
  reference: ReferenceQuote,
  policy: QuotePolicy,
  nowMs: number,
) {
  const age = nowMs - Date.parse(reference.generatedAt);
  if (
    age > policy.maxAgeMs ||
    age < -policy.maxFutureSkewMs ||
    !Number.isFinite(age)
  )
    throw new QuoteError("QUOTE_EXPIRED");
  if (!reference.assetDeploymentMatches || !reference.quoteDeploymentMatches)
    throw new QuoteError("TOKEN_DEPLOYMENT_UNVERIFIED");
  const multiplier = BigInt(reference.multiplier18);
  const bid18 = (BigInt(reference.bid18) * multiplier) / SCALE;
  const ask18 = (BigInt(reference.ask18) * multiplier + SCALE - 1n) / SCALE;
  if (bid18 <= 0n || ask18 > UINT256_MAX)
    throw new QuoteError("INVALID_PRICE_RANGE");
  return {
    bid18: String(bid18),
    ask18: String(ask18),
    generatedAt: reference.generatedAt,
  };
}
export async function fetchReference(
  baseUrl: string,
  identity: TokenIdentity,
  policy: QuotePolicy,
  httpPolicy: HttpPolicy & { robinhoodTransport: RobinhoodTransport },
) {
  const [assets, quotes] = await Promise.all([
    fetchRobinhoodJson(
      new URL("assets", baseUrl),
      httpPolicy,
      httpPolicy.robinhoodTransport,
    ),
    fetchRobinhoodJson(
      new URL(`prices/${encodeURIComponent(identity.symbol)}`, baseUrl),
      httpPolicy,
      httpPolicy.robinhoodTransport,
    ),
  ]);
  return validateReference(assets, quotes, identity, policy, Date.now());
}
