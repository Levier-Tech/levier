const { z } = require("zod");
const catalog = require("../../../data/asset-catalog.json");
const symbols = catalog.map((asset) => asset.ticker);
const feeds = z
  .object(
    Object.fromEntries(
      symbols.map((symbol) => [
        symbol,
        z
          .object({
            id: z.string().regex(/^[0-9a-f]{64}$/),
            symbol: z.literal(`Equity.US.${symbol}/USD`),
          })
          .strict(),
      ]),
    ),
  )
  .strict()
  .superRefine((value, ctx) => {
    const ids = Object.values(value).map((feed) => feed.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate price feed" });
  });
const referenceServerFields = {
  REFERENCE_PRICE_PROVIDER: z.enum(["PYTH", "ROBINHOOD"]),
  // Explicit allowlist prevents accidentally sending the credential to another host.
  PYTH_HERMES_URL: z.literal("https://pyth.dourolabs.app/hermes/"),
  PYTH_API_KEY: z
    .string()
    .max(4096)
    .refine((v) => v === "" || /^\S+$/.test(v)),
  PYTH_MAX_CONFIDENCE_BPS: z.coerce.number().int().min(1).max(100),
  PYTH_REQUEST_BATCH_SIZE: z.coerce.number().int().min(1).max(symbols.length),
  PYTH_FEEDS_JSON: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(feeds),
};
module.exports = { referenceServerFields };
