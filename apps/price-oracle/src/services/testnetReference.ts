import { z } from "zod";
import type { ReferenceTransport } from "./referenceTransport.js";
import {
  fetchRobinhoodJson,
  type RobinhoodTransport,
} from "./robinhoodTransport.js";
import {
  fetchUsdgSnapshot,
  validateUsdgSnapshot,
} from "./krakenBookService.js";
import {
  decimal18,
  fetchJson,
  QuoteError,
  validateReference,
  type HttpPolicy,
  type QuotePolicy,
} from "./robinhoodQuoteService.js";

const level = z.object({
  price: z.string(),
  qty: z.string(),
  publication_ts: z.string().datetime({ offset: true }),
});
const bookSchema = z.object({
  error: z.array(z.string()).max(0),
  result: z.object({
    symbol: z.literal("USDG/USD"),
    base_asset: z.literal("USDG"),
    quote_asset: z.literal("USD"),
    bids: z.array(level).min(1),
    asks: z.array(level).min(1),
  }),
});

export function validateUsdgBook(
  payload: unknown,
  policy: QuotePolicy,
  nowMs: number,
) {
  const parsed = bookSchema.safeParse(payload);
  if (!parsed.success) throw new QuoteError("INVALID_USDG_BOOK");
  const book = parsed.data.result;
  const bid = book.bids[0],
    ask = book.asks[0];
  const bid18 = decimal18(bid.price),
    ask18 = decimal18(ask.price);
  if (
    decimal18(bid.qty) <= 0n ||
    decimal18(ask.qty) <= 0n ||
    ask18 < bid18 ||
    (ask18 - bid18) * 10000n > bid18 * BigInt(policy.maxSpreadBps)
  )
    throw new QuoteError("INVALID_USDG_SPREAD");
  for (const entry of [bid, ask]) {
    const age = nowMs - Date.parse(entry.publication_ts);
    if (
      !Number.isFinite(age) ||
      age > policy.maxAgeMs ||
      age < -policy.maxFutureSkewMs
    )
      throw new QuoteError("STALE_USDG_SOURCE");
  }
  // An unchanged old book level is deliberately rejected; retrieval time never renews source age.
  return {
    price18: String(ask18),
    sourceTimestamp: Math.floor(
      Math.min(Date.parse(bid.publication_ts), Date.parse(ask.publication_ts)) /
        1000,
    ),
    bid: bid.price,
    ask: ask.price,
  };
}

export type ReferenceBinding = {
  mode: "RH_TESTNET_REAL_REFERENCE";
  chainId: 46630;
  stockApiUrl: string;
  usdgBookUrl: string;
  stockSourceId: string;
  stockSymbol: string;
  collateral: string;
  debt: string;
  testnetStockUid: string;
  multiplier18: string;
  stockMaxAgeSeconds: number;
  debtMaxAgeSeconds: number;
  maxSpreadBps: number;
  stockMin18: string;
  stockMax18: string;
  debtMin18: string;
  debtMax18: string;
  maxDeviationBps: number;
  tokenFingerprints: Record<string, unknown>;
};

async function sourceRead<T>(source: string, read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    const code =
      error instanceof QuoteError && /^[A-Z_]{1,60}$/.test(error.message)
        ? error.message
        : "REQUEST_FAILED";
    throw new QuoteError(`${source}_${code}`);
  }
}

export async function fetchTestnetReport(
  binding: ReferenceBinding,
  http: HttpPolicy & {
    robinhoodTransport: RobinhoodTransport;
    usdgTransport: ReferenceTransport;
  },
) {
  if (binding.mode !== "RH_TESTNET_REAL_REFERENCE" || binding.chainId !== 46630)
    throw new QuoteError("TESTNET_BINDING_REQUIRED");
  if (!/^[A-Z][A-Z0-9]{0,15}$/.test(binding.stockSymbol))
    throw new QuoteError("INVALID_STOCK_SYMBOL");
  const api = new URL(binding.stockApiUrl);
  if (
    api.href !== "https://api.robinhood.com/rhj/" ||
    binding.usdgBookUrl !== "wss://ws.kraken.com/v2"
  )
    throw new QuoteError("SOURCE_IDENTITY_MISMATCH");
  const [assets, quotes, book] = await Promise.all([
    sourceRead(
      "STOCK_METADATA",
      fetchRobinhoodJson(new URL("assets", api), http, http.robinhoodTransport),
    ),
    sourceRead(
      "STOCK_PRICE",
      fetchRobinhoodJson(
        new URL(`prices/${binding.stockSymbol}`, api),
        http,
        http.robinhoodTransport,
      ),
    ),
    sourceRead("USDG_BOOK", fetchUsdgSnapshot(binding.usdgBookUrl, http)),
  ]);
  const now = Date.now();
  const policy = {
    maxAgeMs: binding.stockMaxAgeSeconds * 1000,
    maxFutureSkewMs: 0,
    maxSpreadBps: binding.maxSpreadBps,
  };
  const stock = validateReference(
    assets,
    quotes,
    {
      symbol: binding.stockSymbol,
      chainId: binding.chainId,
      address: binding.collateral,
    },
    policy,
    now,
  );
  const identity = z
    .object({
      assets: z.array(z.object({ tokenSymbol: z.string(), id: z.string() })),
    })
    .parse(assets)
    .assets.filter((a) => a.tokenSymbol === binding.stockSymbol);
  if (
    identity.length !== 1 ||
    identity[0].id !== binding.stockSourceId ||
    stock.multiplier18 !== binding.multiplier18
  )
    throw new QuoteError("SOURCE_ASSET_OR_MULTIPLIER_CHANGED");
  const debt = validateUsdgSnapshot(
    book,
    { ...policy, maxAgeMs: binding.debtMaxAgeSeconds * 1000 },
    now,
  );
  // Explicit testnet-only association. The strict native tokenValuation() remains unchanged.
  const collateralPrice18 =
    (BigInt(stock.bid18) * BigInt(binding.multiplier18)) / 10n ** 18n;
  if (
    collateralPrice18 < BigInt(binding.stockMin18) ||
    collateralPrice18 > BigInt(binding.stockMax18) ||
    BigInt(debt.price18) < BigInt(binding.debtMin18) ||
    BigInt(debt.price18) > BigInt(binding.debtMax18)
  )
    throw new QuoteError("REFERENCE_OUT_OF_BOUNDS");
  return {
    mode: binding.mode,
    capturedAt: new Date(now).toISOString(),
    stock,
    debt,
    collateralPrice18: String(collateralPrice18),
    collateralTimestamp: Math.floor(Date.parse(stock.generatedAt) / 1000),
    debtPrice18: debt.price18,
    debtTimestamp: debt.sourceTimestamp,
    nativeDeploymentVerified: false,
  };
}
