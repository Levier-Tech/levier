import { Agent, WebSocket } from "undici";
import type { ConnectionOptions } from "node:tls";
import { fetchJson, QuoteError, type HttpPolicy } from "./boundedHttp.js";
import {
  resolveReferenceHost,
  transportSchema,
  type ReferenceTransport,
} from "./referenceTransport.js";
const HOST = "ws.kraken.com";
export async function createKrakenSocket(
  url: string,
  http: HttpPolicy,
  policy: ReferenceTransport,
) {
  if (url !== "wss://ws.kraken.com/v2")
    throw new QuoteError("SOURCE_IDENTITY_MISMATCH");
  policy = transportSchema.parse(policy);
  const connect: ConnectionOptions & { timeout: number; family: 4 } = {
    servername: HOST,
    rejectUnauthorized: true,
    family: 4,
    timeout: http.timeoutMs,
  };
  if (policy.mode === "HTTPS_DNS") {
    const resolution = await resolveReferenceHost(
      HOST,
      { ...policy, timeoutMs: Math.min(http.timeoutMs, policy.timeoutMs) },
      fetchJson,
    );
    connect.lookup = (hostname, _options, callback) => {
      if (hostname !== HOST)
        return callback(new Error("DNS_IDENTITY_MISMATCH"), "", 4);
      callback(null, resolution.addresses[0], 4);
    };
  }
  const dispatcher = new Agent({ connect });
  try {
    return {
      socket: new WebSocket(url, { dispatcher }),
      dispose: () => {
        void dispatcher.destroy().catch(() => {});
      },
    };
  } catch {
    await dispatcher.destroy();
    throw new QuoteError("UPSTREAM_UNAVAILABLE");
  }
}
