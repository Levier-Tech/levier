const { z } = require("zod");
const { deploymentSchema } = require("./lending.cjs");
const { marginSchema } = require("./margin.cjs");
const catalog = require("../../../data/asset-catalog.json");
const symbols = new Set(catalog.map((x) => x.ticker));
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const marketDeploymentsSchema = z
  .array(
    z
      .object({
        symbol: z.string().refine((v) => symbols.has(v)),
        enabled: z.boolean(),
        long: deploymentSchema,
        margin: marginSchema,
      })
      .strict(),
  )
  .max(catalog.length)
  .superRefine((rows, ctx) => {
    const seen = {
      symbol: new Set(),
      pair: new Set(),
      token: new Set(),
      router: new Set(),
      pool: new Set(),
    };
    for (const [index, row] of rows.entries()) {
      const l = row.long,
        m = row.margin;
      const bindings =
        row.symbol === l.collateralSymbol &&
        row.symbol === m.short.debtSymbol &&
        same(m.longPair, l.pair) &&
        same(m.short.debt, l.collateral) &&
        same(m.short.collateral, l.debt) &&
        same(m.short.registry, l.registry) &&
        m.short.debtDecimals === l.collateralDecimals &&
        m.short.collateralDecimals === l.debtDecimals;
      if (!bindings)
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "Market descriptor binding mismatch",
        });
      for (const [role, values] of Object.entries({
        symbol: [row.symbol],
        pair: [l.pair, m.short.pair],
        token: [l.collateral],
        router: [m.router],
        pool: [m.pool],
      })) {
        for (const value of values) {
          const key = value.toLowerCase();
          if (seen[role].has(key))
            ctx.addIssue({
              code: "custom",
              path: [index],
              message: "Duplicate market identity",
            });
          seen[role].add(key);
        }
      }
    }
  });
module.exports = { marketDeploymentsSchema };
