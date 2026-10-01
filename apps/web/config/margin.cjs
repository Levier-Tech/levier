const { z } = require("zod");
const { parseDeployment } = require("./lending.cjs");
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((v) => !/^0x0{40}$/i.test(v));
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .refine((v) => !/^0x0{64}$/i.test(v));
// Reuse the strict descriptor shape while reversing the assets for the stock-debt pair.
const shortDeploymentSchema = z
  .object({
    chainId: z.union([z.literal(46630), z.literal(4663)]),
    marketId: hash,
    pair: address,
    registry: address,
    oracle: address,
    collateral: address,
    debt: address,
    collateralSymbol: z.literal("USDG"),
    debtSymbol: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{0,15}$/)
      .refine((v) => v !== "USDG"),
    collateralDecimals: z.literal(6),
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
  .strict();
const marginSchema = z
  .object({
    chainId: z.union([z.literal(46630), z.literal(4663)]),
    owner: address,
    router: address,
    factory: address,
    pool: address,
    longPair: address,
    short: shortDeploymentSchema,
    codeHashes: z.object({ router: hash, factory: hash, pool: hash }).strict(),
    policy: z
      .object({
        maxMarginRaw: z.string().regex(/^[1-9]\d*$/),
        slippageBps: z.number().int().min(1).max(100),
        deadlineSeconds: z.number().int().min(30).max(600),
        gasBufferBps: z.number().int().min(11000).max(20000),
        maxGasLimit: z
          .string()
          .regex(/^[1-9]\d{0,6}$/)
          .refine((v) => BigInt(v) >= 21000n && BigInt(v) <= 2000000n),
        longLeveragesBps: z
          .array(z.number().int().min(10001).max(17500))
          .min(1)
          .max(4),
        shortExposureBps: z
          .array(z.number().int().min(1).max(12500))
          .min(1)
          .max(4),
      })
      .strict(),
  })
  .strict();
module.exports = { marginSchema, parseDeployment };
