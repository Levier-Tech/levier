import { isIP } from "node:net";
import { z } from "zod";
import { fetchJson, QuoteError } from "./boundedHttp.js";
const REFERENCE_HOSTS = new Set(["api.robinhood.com", "ws.kraken.com"]);
export type ReferenceHost = "api.robinhood.com" | "ws.kraken.com";
export const transportSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("SYSTEM") }).strict(),
  z
    .object({
      mode: z.literal("HTTPS_DNS"),
      resolverUrl: z.literal("https://dns.google/resolve"),
      timeoutMs: z.number().int().positive().max(10000),
      maxResponseBytes: z.number().int().min(1024).max(65536),
      maxTtlSeconds: z.number().int().min(1).max(300),
    })
    .strict(),
]);
export type ReferenceTransport = z.infer<typeof transportSchema>;
export function parseReferenceTransport(
  raw: string | undefined,
): ReferenceTransport {
  try {
    return transportSchema.parse(JSON.parse(raw as string));
  } catch {
    throw new QuoteError("INVALID_REFERENCE_TRANSPORT_JSON");
  }
}
export function isPublicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
const dnsSchema = z.object({
  Status: z.literal(0),
  Question: z
    .array(z.object({ name: z.string(), type: z.literal(1) }))
    .length(1),
  Answer: z
    .array(
      z.object({
        name: z.string(),
        type: z.number().int(),
        TTL: z.number().int().nonnegative().max(2147483647),
        data: z.string(),
      }),
    )
    .min(1)
    .max(32),
});
export function validateReferenceDns(
  payload: unknown,
  hostname: ReferenceHost,
  maxTtlSeconds: number,
) {
  if (!REFERENCE_HOSTS.has(hostname))
    throw new QuoteError("DNS_IDENTITY_MISMATCH");
  const data = dnsSchema.parse(payload);
  const normalize = (s: string) => s.toLowerCase().replace(/\.$/, "");
  if (normalize(data.Question[0].name) !== hostname)
    throw new QuoteError("DNS_IDENTITY_MISMATCH");
  const records = data.Answer.filter(
    (r) => r.type === 1 && normalize(r.name) === hostname,
  );
  if (!records.length || records.some((r) => !isPublicIpv4(r.data)))
    throw new QuoteError("DNS_ADDRESS_REJECTED");
  return {
    addresses: [...new Set(records.map((r) => r.data))],
    ttlSeconds: Math.min(maxTtlSeconds, ...records.map((r) => r.TTL)),
  };
}
type Resolution = ReturnType<typeof validateReferenceDns>;
const cache = new Map<string, { expiresAt: number; resolution: Resolution }>();
const pending = new Map<string, Promise<Resolution>>();
export async function resolveReferenceHost(
  hostname: ReferenceHost,
  policy: Extract<ReferenceTransport, { mode: "HTTPS_DNS" }>,
  fetcher: typeof fetchJson,
) {
  const key = hostname + JSON.stringify(policy),
    prior = cache.get(key);
  if (prior && prior.expiresAt > Date.now()) return prior.resolution;
  let request = pending.get(key);
  if (!request) {
    request = (async () => {
      const url = new URL(policy.resolverUrl);
      url.searchParams.set("name", hostname);
      url.searchParams.set("type", "A");
      const resolution = validateReferenceDns(
        await fetcher(url, policy),
        hostname,
        policy.maxTtlSeconds,
      );
      cache.set(key, {
        resolution,
        expiresAt: Date.now() + resolution.ttlSeconds * 1000,
      });
      return resolution;
    })().finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}
