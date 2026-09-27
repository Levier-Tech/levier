export type HttpPolicy = { timeoutMs: number; maxResponseBytes: number };
export class QuoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export async function fetchJson(
  url: URL,
  policy: HttpPolicy,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(policy.timeoutMs),
    });
    if (!response.ok || !response.body)
      throw new QuoteError("UPSTREAM_UNAVAILABLE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > policy.maxResponseBytes)
          throw new QuoteError("RESPONSE_TOO_LARGE");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("UPSTREAM_UNAVAILABLE");
  }
}
