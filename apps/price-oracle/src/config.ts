import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";
import { parseRobinhoodTransport } from "./services/robinhoodTransport.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env.testnet") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.testnet") });

export const oracleEnvironmentSchema = z
  .object({
    NETWORK_MODE: z.literal("TESTNET"),
    CHAIN_ID: z.literal("46630").transform(Number),
    TRADING_ENABLED: z.literal("false"),
    ORACLE_WORKER_MODE: z.enum(["DISABLED", "OBSERVE"]),
    ROBINHOOD_TRANSPORT_JSON: z
      .string()
      .default(
        '{"mode":"HTTPS_DNS","resolverUrl":"https://dns.google/resolve","timeoutMs":5000,"maxResponseBytes":16384,"maxTtlSeconds":60}',
      )
      .transform((raw, ctx) => {
        try {
          return parseRobinhoodTransport(raw);
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid transport" });
          return z.NEVER;
        }
      }),
    ROBINHOOD_STOCK_API_URL: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname.endsWith("/")
        );
      }),
    ORACLE_POLL_INTERVAL_MS: z.coerce.number().int().min(15000),
    ORACLE_HTTP_TIMEOUT_MS: z.coerce.number().int().positive(),
    ORACLE_MAX_RESPONSE_BYTES: z.coerce.number().int().positive(),
    ORACLE_MAX_QUOTE_AGE_MS: z.coerce.number().int().positive(),
    ORACLE_MAX_FUTURE_SKEW_MS: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
    ORACLE_MAX_SPREAD_BPS: z.coerce.number().int().positive().max(10000),
    ORACLE_SYMBOLS_JSON: z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid JSON" });
          return z.NEVER;
        }
      })
      .pipe(
        z
          .array(z.string().regex(/^[A-Z][A-Z0-9.]{0,15}$/))
          .min(1)
          .max(20),
      )
      .refine((a) => new Set(a).size === a.length),
    PROTOCOL_ADDRESSES: z
      .string()
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid JSON" });
          return z.NEVER;
        }
      })
      .pipe(
        z.object({
          tokens: z.record(
            z.string(),
            z
              .string()
              .regex(/^0x[0-9a-fA-F]{40}$/)
              .refine((a) => !/^0x0{40}$/.test(a)),
          ),
        }),
      ),
  })
  .superRefine((value, ctx) => {
    for (const symbol of value.ORACLE_SYMBOLS_JSON)
      if (!value.PROTOCOL_ADDRESSES.tokens[symbol])
        ctx.addIssue({
          code: "custom",
          path: ["ORACLE_SYMBOLS_JSON"],
          message: "Missing token identity",
        });
  });

export function loadOracleConfig(values: NodeJS.ProcessEnv = process.env) {
  const parsed = oracleEnvironmentSchema.safeParse(values);
  if (!parsed.success)
    throw new Error(
      `Invalid oracle ENV fields: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`,
    );
  return parsed.data;
}
