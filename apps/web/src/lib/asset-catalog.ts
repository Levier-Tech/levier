import { z } from "zod";
import catalog from "../../../../data/asset-catalog.json";
export const assetCatalog = z
  .array(
    z.object({
      ticker: z.string().regex(/^[A-Z0-9]+$/),
      name: z.string().min(1),
      image: z.string().startsWith("/assets/"),
      className: z.string(),
      indexStr: z.string(),
      featured: z.boolean(),
    }),
  )
  .parse(catalog);
export function marketPath(symbol: string) {
  return `/markets/${encodeURIComponent(symbol.toLowerCase())}`;
}
export function tradePath(symbol: string) {
  return `/trade?asset=${encodeURIComponent(symbol)}`;
}
