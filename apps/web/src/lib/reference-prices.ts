import { z } from "zod";
export const referencePricesSchema = z
  .object({
    capturedAt: z.string().datetime(),
    maxAgeMs: z.number().int().positive(),
    source: z.enum(["Robinhood stock reference", "Pyth stock reference"]),
    prices: z.array(
      z
        .object({
          symbol: z.string().regex(/^[A-Z0-9]+$/),
          quote: z
            .object({
              mid18: z.string().regex(/^[1-9]\d*$/),
              generatedAt: z.string().datetime({ offset: true }),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type ReferencePrices = z.infer<typeof referencePricesSchema>;
export function displayReferencePrice(
  data: ReferencePrices | undefined,
  symbol: string,
  nowMs: number,
): string | null {
  const row = data?.prices.find((x) => x.symbol === symbol);
  if (!row?.quote || !data) return null;
  const age = nowMs - Date.parse(row.quote.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > data.maxAgeMs) return null;
  const cents = (BigInt(row.quote.mid18) + 5n * 10n ** 15n) / 10n ** 16n;
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
