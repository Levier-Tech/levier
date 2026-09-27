import https from "node:https";
import { fetchJson, QuoteError, type HttpPolicy } from "./boundedHttp.js";
import {
  transportSchema,
  parseReferenceTransport,
  resolveReferenceHost,
  type ReferenceTransport,
} from "./referenceTransport.js";
const HOST = "api.robinhood.com";
export type RobinhoodTransport = ReferenceTransport;
export function parseRobinhoodTransport(
  raw: string | undefined,
): RobinhoodTransport {
  try {
    return parseReferenceTransport(raw);
  } catch {
    throw new QuoteError("INVALID_ROBINHOOD_TRANSPORT_JSON");
  }
}
/** Resolves only Robinhood's public hostname. TLS still verifies its original identity. */
export async function fetchRobinhoodJson(
  url: URL,
  http: HttpPolicy,
  transport: RobinhoodTransport,
  dependencies = { fetchJson, get: https.get },
): Promise<unknown> {
  try {
    transport = transportSchema.parse(transport);
    if (
      url.origin !== `https://${HOST}` ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/rhj\/(assets|prices\/[A-Z0-9]+)$/.test(url.pathname)
    )
      throw new QuoteError("ROBINHOOD_URL_REJECTED");
    if (
      !Number.isSafeInteger(http.timeoutMs) ||
      http.timeoutMs <= 0 ||
      !Number.isSafeInteger(http.maxResponseBytes) ||
      http.maxResponseBytes <= 0
    )
      throw new QuoteError("INVALID_HTTP_POLICY");
    if (transport.mode === "SYSTEM")
      return await dependencies.fetchJson(url, http);
    const deadline = Date.now() + http.timeoutMs;
    const resolution = await resolveReferenceHost(
      HOST,
      {
        ...transport,
        timeoutMs: Math.min(transport.timeoutMs, http.timeoutMs),
      },
      dependencies.fetchJson,
    );
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new QuoteError("UPSTREAM_TIMEOUT");
    return await new Promise((resolve, reject) => {
      const request = dependencies.get(
        url,
        {
          servername: HOST,
          rejectUnauthorized: true,
          family: 4,
          lookup: (hostname, _options, callback) => {
            if (hostname !== HOST)
              return callback(new Error("DNS_IDENTITY_MISMATCH"), "", 4);
            callback(null, resolution.addresses[0], 4);
          },
          headers: { Accept: "application/json" },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new QuoteError("UPSTREAM_UNAVAILABLE"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > http.maxResponseBytes)
              request.destroy(new QuoteError("RESPONSE_TOO_LARGE"));
            else chunks.push(chunk);
          });
          response.on("error", () =>
            reject(new QuoteError("UPSTREAM_UNAVAILABLE")),
          );
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new QuoteError("INVALID_RESPONSE"));
            }
          });
        },
      );
      const timer = setTimeout(
        () => request.destroy(new QuoteError("UPSTREAM_TIMEOUT")),
        remaining,
      );
      request.on("error", () => reject(new QuoteError("UPSTREAM_UNAVAILABLE")));
      request.on("close", () => clearTimeout(timer));
    });
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("UPSTREAM_UNAVAILABLE");
  }
}
