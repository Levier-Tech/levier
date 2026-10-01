const { z } = require("zod");
const { marginSchema } = require("./margin.cjs");
const { marketDeploymentsSchema } = require("./market-deployments.cjs");
const { referenceServerFields } = require("./reference-prices.cjs");
const { deploymentSchema, parseDeployment } = require("./lending.cjs");
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((value) => !/^0x0{40}$/.test(value));
const positiveInteger = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const protocolSchema = z
  .object({
    usdg: address,
    oracle: address,
    registry: address,
    levierRouter: address,
    leverageRouter: address,
    shortRouter: address,
    autoProtect: address,
    levierVault: address,
    tokens: z.record(z.string().regex(/^[A-Z0-9]+$/), address),
    pairs: z.record(z.string().regex(/^[A-Z0-9]+$/), address),
  })
  .strict();
const clientSchema = z
  .object({
    NETWORK_MODE: z.enum(["TESTNET", "MAINNET"]),
    CHAIN_ID: positiveInteger,
    CHAIN_NAME: z.string().min(1),
    EXPLORER_URL: z.string().url(),
    NATIVE_CURRENCY_NAME: z.string().min(1),
    NATIVE_CURRENCY_SYMBOL: z.string().min(1),
    NATIVE_CURRENCY_DECIMALS: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(36)),
    USDG_ADDRESS: address,
    PROTOCOL_ADDRESSES: z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value);
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid JSON" });
          return z.NEVER;
        }
      })
      .pipe(protocolSchema),
    TRADING_ENABLED: z
      .enum(["true", "false"])
      .transform((value) => value === "true"),
    MARGIN_TRADING_ENABLED: z
      .enum(["true", "false"])
      .transform((v) => v === "true"),
    MARKET_DEPLOYMENTS_JSON: z
      .string()
      .transform((v, ctx) => {
        try {
          return JSON.parse(v);
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid JSON" });
          return z.NEVER;
        }
      })
      .pipe(marketDeploymentsSchema),
    MARGIN_DEPLOYMENT_JSON: z
      .string()
      .transform(parseDeployment)
      .pipe(marginSchema.nullable()),
    LENDING_ENABLED: z.enum(["true", "false"]).transform((v) => v === "true"),
    LENDING_DEPLOYMENT_JSON: z
      .string()
      .transform(parseDeployment)
      .pipe(deploymentSchema.nullable()),
    LENDING_RECEIPT_CONFIRMATIONS: positiveInteger,
    LENDING_RECEIPT_TIMEOUT_MS: positiveInteger,
    // Testnet only; mainnet has no faucet and must leave it empty.
    USDG_FAUCET_URL: z.union([
      z.literal(""),
      z
        .string()
        .url()
        .refine((v) => new URL(v).protocol === "https:"),
    ]),
    UI_POLL_INTERVAL_MS: positiveInteger,
    TOKEN_CA: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const expectedChainId = { TESTNET: 46630, MAINNET: 4663 }[
      value.NETWORK_MODE
    ];
    if (value.CHAIN_ID !== expectedChainId)
      ctx.addIssue({
        code: "custom",
        path: ["CHAIN_ID"],
        message: "Chain ID does not match NETWORK_MODE",
      });
    if ((value.NETWORK_MODE === "TESTNET") !== (value.USDG_FAUCET_URL !== ""))
      ctx.addIssue({
        code: "custom",
        path: ["USDG_FAUCET_URL"],
        message: "Faucet is required on testnet and forbidden on mainnet",
      });
    const lending = value.LENDING_DEPLOYMENT_JSON;
    const margin = value.MARGIN_DEPLOYMENT_JSON;
    for (const row of value.MARKET_DEPLOYMENTS_JSON) {
      if (
        row.long.chainId !== value.CHAIN_ID ||
        row.long.debt.toLowerCase() !== value.USDG_ADDRESS.toLowerCase() ||
        row.long.collateral.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.tokens[row.symbol]?.toLowerCase() ||
        row.long.pair.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.pairs[row.symbol]?.toLowerCase() ||
        row.long.registry.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.registry.toLowerCase()
      )
        ctx.addIssue({
          code: "custom",
          path: ["MARKET_DEPLOYMENTS_JSON"],
          message: "Deployment collection identity mismatch",
        });
    }
    if (
      margin &&
      lending &&
      !value.MARKET_DEPLOYMENTS_JSON.some(
        (row) =>
          JSON.stringify(row.long) === JSON.stringify(lending) &&
          JSON.stringify(row.margin) === JSON.stringify(margin),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["MARKET_DEPLOYMENTS_JSON"],
        message: "Existing accepted deployment must be preserved",
      });
    if (
      value.MARGIN_TRADING_ENABLED &&
      (!margin || !lending || value.TRADING_ENABLED)
    )
      ctx.addIssue({
        code: "custom",
        path: ["MARGIN_TRADING_ENABLED"],
        message: "Verified margin deployment required",
      });
    if (
      margin &&
      (!lending ||
        margin.longPair.toLowerCase() !== lending.pair.toLowerCase() ||
        margin.short.collateral.toLowerCase() !== lending.debt.toLowerCase() ||
        margin.short.debt.toLowerCase() !== lending.collateral.toLowerCase() ||
        margin.short.registry.toLowerCase() !==
          lending.registry.toLowerCase() ||
        margin.short.debtSymbol !== lending.collateralSymbol ||
        margin.short.debtDecimals !== lending.collateralDecimals ||
        margin.short.collateralDecimals !== lending.debtDecimals)
    )
      ctx.addIssue({
        code: "custom",
        path: ["MARGIN_DEPLOYMENT_JSON"],
        message: "Margin asset identity mismatch",
      });
    if (value.LENDING_ENABLED && (!lending || value.TRADING_ENABLED))
      ctx.addIssue({
        code: "custom",
        path: ["LENDING_ENABLED"],
        message:
          "Verified lending deployment and disabled legacy trading required",
      });
    if (
      lending &&
      (value.CHAIN_ID !== lending.chainId ||
        lending.debt.toLowerCase() !== value.USDG_ADDRESS.toLowerCase() ||
        lending.collateral.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.tokens[
            lending.collateralSymbol
          ]?.toLowerCase() ||
        lending.pair.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.pairs[
            lending.collateralSymbol
          ]?.toLowerCase() ||
        lending.registry.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.registry.toLowerCase() ||
        lending.oracle.toLowerCase() !==
          value.PROTOCOL_ADDRESSES.oracle.toLowerCase())
    )
      ctx.addIssue({
        code: "custom",
        path: ["LENDING_DEPLOYMENT_JSON"],
        message: "Deployment identity mismatch",
      });

    if (
      value.PROTOCOL_ADDRESSES.usdg.toLowerCase() !==
        value.USDG_ADDRESS.toLowerCase() ||
      value.PROTOCOL_ADDRESSES.tokens.USDG?.toLowerCase() !==
        value.USDG_ADDRESS.toLowerCase()
    )
      ctx.addIssue({
        code: "custom",
        path: ["PROTOCOL_ADDRESSES"],
        message: "USDG identity mismatch",
      });
  });
const serverSchema = z.object({
  ...referenceServerFields,
  ROBINHOOD_TRANSPORT_JSON: z.string().min(1),
  BACKEND_API_URL: z.string().url(),
  RPC_URL: z.string().url(),
  RPC_TIMEOUT_MS: positiveInteger,
  ANALYTICS_MAX_BLOCK_AGE_SECONDS: positiveInteger,
  ROBINHOOD_STOCK_API_URL: z
    .string()
    .url()
    .refine((v) => v === "https://api.robinhood.com/rhj/"),
  REFERENCE_PRICE_POLICY_JSON: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .object({
          timeoutMs: z.number().int().positive().max(30000),
          maxResponseBytes: z.number().int().positive().max(4194304),
          maxAgeMs: z.number().int().positive().max(90000),
          maxFutureSkewMs: z.literal(0),
          maxSpreadBps: z.number().int().min(1).max(100),
          cacheMs: z.number().int().positive().max(15000),
        })
        .strict(),
    ),
  RPC_MAX_BODY_BYTES: positiveInteger,
  RPC_MAX_RESPONSE_BYTES: positiveInteger,
  RPC_MAX_BATCH_SIZE: positiveInteger,
});
function validate(schema, values) {
  const result = schema.safeParse(values);
  if (!result.success)
    throw new Error(
      `Invalid ENV fields: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  return result.data;
}
module.exports = { clientSchema, serverSchema, validate };
