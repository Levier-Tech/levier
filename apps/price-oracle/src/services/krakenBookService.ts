import { z } from "zod";
import { createKrakenSocket } from "./krakenTransport.js";
import type { ReferenceTransport } from "./referenceTransport.js";
import {
  decimal18,
  QuoteError,
  type HttpPolicy,
  type QuotePolicy,
} from "./robinhoodQuoteService.js";

const level = z.object({ price: z.string(), qty: z.string() });
const snapshotSchema = z.object({
  channel: z.literal("book"),
  type: z.literal("snapshot"),
  data: z
    .array(
      z.object({
        symbol: z.literal("USDG/USD"),
        bids: z.array(level).length(10),
        asks: z.array(level).length(10),
        checksum: z.number().int().min(0).max(0xffffffff),
        timestamp: z.string().datetime({ offset: true }),
      }),
    )
    .length(1),
});

/** Node 22+ source-aware JSON decoding preserves exchange decimal lexemes for CRC32. */
export function decodeBookMessage(text: string): unknown {
  const decode = JSON.parse as (
    source: string,
    reviver: (
      key: string,
      value: unknown,
      context?: { source?: string },
    ) => unknown,
  ) => unknown;
  try {
    return decode(text, (key, value, context) => {
      if ((key === "price" || key === "qty") && typeof value === "number") {
        if (!context?.source)
          throw new QuoteError("EXACT_JSON_DECODER_REQUIRED");
        return context.source;
      }
      return value;
    });
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("INVALID_USDG_SNAPSHOT");
  }
}

export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(text, "ascii")) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateUsdgSnapshot(
  payload: unknown,
  policy: QuotePolicy,
  nowMs: number,
) {
  const result = snapshotSchema.safeParse(payload);
  if (!result.success) throw new QuoteError("INVALID_USDG_SNAPSHOT");
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(policy.maxAgeMs) ||
    policy.maxAgeMs <= 0 ||
    !Number.isSafeInteger(policy.maxSpreadBps) ||
    policy.maxSpreadBps <= 0 ||
    policy.maxSpreadBps > 10000 ||
    !Number.isSafeInteger(policy.maxFutureSkewMs) ||
    policy.maxFutureSkewMs < 0
  )
    throw new QuoteError("INVALID_POLICY");
  const book = result.data.data[0];
  const age = nowMs - Date.parse(book.timestamp);
  if (Number.isFinite(age) && age < -policy.maxFutureSkewMs)
    throw new QuoteError("FUTURE_USDG_SOURCE");
  if (!Number.isFinite(age) || age > policy.maxAgeMs)
    throw new QuoteError("STALE_USDG_SOURCE");
  let input = "";
  for (const [side, levels] of [
    ["asks", book.asks],
    ["bids", book.bids],
  ] as const) {
    let previous: bigint | undefined;
    for (const entry of levels) {
      const price = decimal18(entry.price);
      decimal18(entry.qty);
      if (
        previous !== undefined &&
        (side === "asks" ? price <= previous : price >= previous)
      )
        throw new QuoteError("UNSORTED_USDG_BOOK");
      previous = price;
      input +=
        entry.price.replace(".", "").replace(/^0+/, "") +
        entry.qty.replace(".", "").replace(/^0+/, "");
    }
  }
  if (crc32(input) !== book.checksum)
    throw new QuoteError("USDG_CHECKSUM_MISMATCH");
  const bid18 = decimal18(book.bids[0].price),
    ask18 = decimal18(book.asks[0].price);
  if (
    ask18 < bid18 ||
    (ask18 - bid18) * 10000n > bid18 * BigInt(policy.maxSpreadBps)
  )
    throw new QuoteError("INVALID_USDG_SPREAD");
  return {
    source: "KRAKEN_WS_V2_BOOK" as const,
    price18: String(ask18),
    sourceTimestamp: Math.floor(Date.parse(book.timestamp) / 1000),
    bid: book.bids[0].price,
    ask: book.asks[0].price,
    checksum: book.checksum,
    snapshot: book,
  };
}

/** One complete fresh snapshot per observation; deltas/heartbeats never renew a price's timestamp. */
export async function fetchUsdgSnapshot(
  url: string,
  http: HttpPolicy & { usdgTransport: ReferenceTransport },
): Promise<unknown> {
  if (url !== "wss://ws.kraken.com/v2")
    throw new QuoteError("SOURCE_IDENTITY_MISMATCH");
  if (
    !Number.isSafeInteger(http.timeoutMs) ||
    http.timeoutMs <= 0 ||
    !Number.isSafeInteger(http.maxResponseBytes) ||
    http.maxResponseBytes <= 0
  )
    throw new QuoteError("INVALID_POLICY");
  const deadline = Date.now() + http.timeoutMs;
  const { socket, dispose } = await createKrakenSocket(
    url,
    http,
    http.usdgTransport,
  );
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    dispose();
    throw new QuoteError("USDG_SNAPSHOT_TIMEOUT");
  }
  return new Promise((resolve, reject) => {
    let done = false,
      size = 0;
    const finish = (error?: QuoteError, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      dispose();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new QuoteError("USDG_SNAPSHOT_TIMEOUT")),
      remaining,
    );
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          method: "subscribe",
          params: {
            channel: "book",
            symbol: ["USDG/USD"],
            depth: 10,
            snapshot: true,
          },
        }),
      ),
    );
    socket.addEventListener("message", (event) => {
      if (done) return;
      try {
        if (typeof event.data !== "string")
          throw new QuoteError("INVALID_USDG_SNAPSHOT");
        size += Buffer.byteLength(event.data);
        if (size > http.maxResponseBytes)
          throw new QuoteError("RESPONSE_TOO_LARGE");
        const payload = decodeBookMessage(event.data) as {
          channel?: string;
          type?: string;
          success?: boolean;
        };
        if (payload.success === false)
          throw new QuoteError("UPSTREAM_UNAVAILABLE");
        if (payload.channel === "book") {
          if (payload.type !== "snapshot")
            throw new QuoteError("COMPLETE_SNAPSHOT_REQUIRED");
          finish(undefined, payload);
        }
      } catch (error) {
        finish(
          error instanceof QuoteError
            ? error
            : new QuoteError("UPSTREAM_UNAVAILABLE"),
        );
      }
    });
    socket.addEventListener("error", () =>
      finish(new QuoteError("UPSTREAM_UNAVAILABLE")),
    );
    socket.addEventListener("close", () => {
      if (!done) finish(new QuoteError("UPSTREAM_UNAVAILABLE"));
    });
  });
}
