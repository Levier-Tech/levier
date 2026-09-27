const { z } = require("zod");
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((v) => !/^0x0{40}$/i.test(v));
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .refine((v) => !/^0x0{64}$/i.test(v));
const deploymentSchema = z
  .object({
    chainId: z.literal(46630),
    marketId: hash,
    pair: address,
    registry: address,
    oracle: address,
    collateral: address,
    debt: address,
    collateralSymbol: z.string().regex(/^[A-Z][A-Z0-9]{0,15}$/),
    debtSymbol: z.literal("USDG"),
    collateralDecimals: z.number().int().min(0).max(36),
    debtDecimals: z.number().int().min(0).max(36),
    codeHashes: z
      .object({
        pair: hash,
        registry: hash,
        oracle: hash,
        collateral: hash,
        debt: hash,
      })
      .strict(),
  })
  .strict()
  .refine((d) => d.collateral.toLowerCase() !== d.debt.toLowerCase());
function parseDeployment(value, ctx) {
  if (value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid deployment JSON" });
    return z.NEVER;
  }
}
module.exports = { deploymentSchema, parseDeployment };
