import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { z } = requireWeb("zod");
const { deploymentSchema } = requireWeb("./config/lending.cjs");
const { marginSchema } = requireWeb("./config/margin.cjs");
export const targetSymbols = JSON.parse(
  readFileSync(
    new URL("../../data/asset-catalog.json", import.meta.url),
    "utf8",
  ),
).map((x) => x.ticker);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((x) => !/^0x0{40}$/i.test(x));
const source = z
  .string()
  .url()
  .refine((x) => {
    const url = new URL(x);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });
export const preparationFields = [
  "TOKEN_ADDRESS",
  "TOKEN_SOURCE_URL",
  "REFERENCE_BINDING_JSON",
  "LENDING_DEPLOYMENT_JSON",
  "MARGIN_DEPLOYMENT_JSON",
];
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Preparation metadata does not authorize deployment or enable browser execution.
// Empty values are explicit pending work; absent fields are configuration errors.
export function readMarketScope(env) {
  if (env.NETWORK_MODE !== "TESTNET" || env.CHAIN_ID !== "46630")
    throw Error("MARKET_SCOPE_TESTNET_REQUIRED");
  if (new Set(targetSymbols).size !== targetSymbols.length)
    throw Error("MARKET_SCOPE_DUPLICATE_SYMBOL");
  const seenTokens = new Set();
  const seenPairs = new Set();
  return targetSymbols.map((symbol) => {
    const values = {};
    for (const field of preparationFields) {
      const name = `RH_${symbol}_${field}`;
      if (typeof env[name] !== "string")
        throw Error(`Missing ENV field: ${name}`);
      values[field] = env[name];
    }
    try {
      const token =
        values.TOKEN_ADDRESS === ""
          ? null
          : address.parse(values.TOKEN_ADDRESS);
      const tokenSource =
        values.TOKEN_SOURCE_URL === ""
          ? null
          : source.parse(values.TOKEN_SOURCE_URL);
      // Full price-source binding is verified by the publisher before acceptance.
      const binding =
        values.REFERENCE_BINDING_JSON === ""
          ? null
          : JSON.parse(values.REFERENCE_BINDING_JSON);
      const long =
        values.LENDING_DEPLOYMENT_JSON === ""
          ? null
          : deploymentSchema.parse(JSON.parse(values.LENDING_DEPLOYMENT_JSON));
      const margin =
        values.MARGIN_DEPLOYMENT_JSON === ""
          ? null
          : marginSchema.parse(JSON.parse(values.MARGIN_DEPLOYMENT_JSON));
      if (
        values.REFERENCE_BINDING_JSON !== "" &&
        (!binding ||
          typeof binding !== "object" ||
          Array.isArray(binding) ||
          binding.chainId !== 46630 ||
          binding.mode !== "RH_TESTNET_REAL_REFERENCE" ||
          !token ||
          !same(binding.collateral, token))
      )
        throw Error();
      if (token && seenTokens.has(token.toLowerCase())) throw Error();
      if (token) seenTokens.add(token.toLowerCase());
      if (
        long &&
        (!token ||
          !same(long.collateral, token) ||
          long.collateralSymbol !== symbol ||
          !same(long.debt, env.USDG_ADDRESS))
      )
        throw Error();
      if (
        margin &&
        (!long ||
          !same(margin.longPair, long.pair) ||
          margin.short.debtSymbol !== symbol ||
          !same(margin.short.debt, token) ||
          !same(margin.short.collateral, long.debt) ||
          !same(margin.short.registry, long.registry) ||
          margin.short.debtDecimals !== long.collateralDecimals ||
          margin.short.collateralDecimals !== long.debtDecimals)
      )
        throw Error();
      for (const pair of [long?.pair, margin?.short.pair].filter(Boolean)) {
        if (seenPairs.has(pair.toLowerCase())) throw Error();
        seenPairs.add(pair.toLowerCase());
      }
      return {
        symbol,
        token,
        tokenSourceConfigured: tokenSource !== null,
        referenceBindingConfigured: binding !== null,
        long,
        margin,
      };
    } catch {
      throw Error(
        `Invalid market preparation fields: RH_${symbol}_* (values redacted)`,
      );
    }
  });
}
