import { z } from "zod";

export interface OracleStatus {
  asset: string;
  primaryPrice: number;
  twapPrice: number;
  deviationBps: number;
  isSafe: boolean;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
}

export interface PositionData {
  id: string;
  asset: string;
  isLong: boolean;
  sizeUsd: number;
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  pnlUsd: number;
  pnlPercentage: number;
}

export const ponsMarketEntrySchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string().default("Unknown Token"),
  image: z.string().nullish().transform((v) => v || ""),
  description: z.string().nullish().transform((v) => v || ""),
  websiteUrl: z.string().nullish().transform((v) => v || null),
  twitterUrl: z.string().nullish().transform((v) => v || null),
  telegramUrl: z.string().nullish().transform((v) => v || null),
  discordUrl: z.string().nullish().transform((v) => v || null),
  graduated: z.boolean().default(true),
  eligible: z.boolean().default(false),
  liquidity: z.coerce.number().default(0),
  marketCap: z.coerce.number().default(0),
  volume24h: z.coerce.number().default(0),
  price: z.coerce.number().default(0),
  change24h: z.coerce.number().default(0),
  maxLeverage: z.coerce.number().default(10),
  leverageEnabled: z.boolean().default(true),
  ineligibleReason: z.string().nullish().transform((v) => v || null),
  coingeckoId: z.string().optional(),
});

export type PonsMarketEntry = z.infer<typeof ponsMarketEntrySchema>;

export const ponsMarketsResponseSchema = z.object({
  markets: z.array(ponsMarketEntrySchema),
  updatedAt: z.number().default(() => Date.now()),
});

export type PonsMarketsResponse = z.infer<typeof ponsMarketsResponseSchema>;

// ─── API Client ─────────────────────────────────────────────────────────

/**
 * Fetch the list of Pons-graduated markets from the API.
 */
export async function fetchPonsMarkets(): Promise<PonsMarketEntry[]> {
  const res = await fetch("/api/pons/markets", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Pons markets unavailable (${res.status})`);
  }
  const json = await res.json();
  const parsed = ponsMarketsResponseSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data.markets;
  }
  
  console.warn("Pons markets schema validation warning:", parsed.error);
  if (Array.isArray(json?.markets)) {
    return json.markets as PonsMarketEntry[];
  }
  if (Array.isArray(json?.tokens)) {
    return json.tokens as PonsMarketEntry[];
  }
  return [];
}

export const ponsClient = {
  /**
   * Fetches the list of graduated Pons assets from the indexer API.
   */
  getMarkets: fetchPonsMarkets,

  /**
   * Fetches the oracle status for all assets or a specific asset.
   */
  getOracleStatus: async (asset?: string): Promise<OracleStatus | OracleStatus[]> => {
    const url = asset ? `/api/oracle/status?asset=${asset}` : "/api/oracle/status";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch oracle status: ${response.statusText}`);
    }
    const data = await response.json();
    return asset ? data : data.statuses;
  },

  /**
   * Fetches active leveraged positions for an account.
   */
  getPositions: async (account: string): Promise<PositionData[]> => {
    const response = await fetch(`/api/positions?account=${account}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch positions: ${response.statusText}`);
    }
    const data = await response.json();
    return data.positions;
  },
};
