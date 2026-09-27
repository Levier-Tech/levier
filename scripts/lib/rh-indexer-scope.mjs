import { createRequire } from "node:module";
import { descriptorHash } from "./rh-indexer.mjs";
const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { z } = requireWeb("zod");
const { deploymentSchema } = requireWeb("./config/lending.cjs");
const { marginSchema } = requireWeb("./config/margin.cjs");
const scopeSchema = z
  .array(
    z
      .object({
        symbol: z.enum(["TSLA", "AMZN", "PLTR", "NFLX", "AMD"]),
        side: z.enum(["long", "short"]),
        startBlock: z.string().regex(/^[1-9]\d*$/),
        deployment: z.union([deploymentSchema, marginSchema.shape.short]),
      })
      .strict(),
  )
  .min(1)
  .max(10);
export function indexerScopes(raw) {
  let entries;
  try {
    entries = scopeSchema.parse(JSON.parse(raw));
  } catch {
    throw Error("INDEXER_MARKETS_CONFIG_INVALID");
  }
  const pairs = new Set(),
    labels = new Set();
  return entries.map((entry) => {
    const d = entry.deployment,
      pair = d.pair.toLowerCase(),
      label = `${entry.symbol}:${entry.side}`;
    if (
      pairs.has(pair) ||
      labels.has(label) ||
      (entry.side === "long"
        ? d.collateralSymbol !== entry.symbol || d.debtSymbol !== "USDG"
        : d.debtSymbol !== entry.symbol || d.collateralSymbol !== "USDG")
    )
      throw Error("INDEXER_MARKET_SCOPE_MISMATCH");
    pairs.add(pair);
    labels.add(label);
    return {
      ...entry,
      scope: {
        chainId: d.chainId,
        pair,
        startBlock: BigInt(entry.startBlock),
        descriptorHash: descriptorHash(d),
      },
    };
  });
}
