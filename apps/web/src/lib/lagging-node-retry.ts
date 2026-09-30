import { http, type HttpTransportConfig, type Transport } from "viem";

// The RPC endpoint sits behind several nodes. A node that is a block behind rejects reads pinned to the
// newest block ("unsupported block number"), so retry only those rejections. Sends are never retried.
const behindNode =
  /unsupported block number|header not found|block not found|unknown block/i;

export function retryingHttp(
  url: string,
  config: HttpTransportConfig,
): Transport {
  const base = http(url, config);
  return (options) => {
    const inner = base(options);
    const request = (async (args: Parameters<typeof inner.request>[0]) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await inner.request(args);
        } catch (error) {
          const e = error as { details?: string; shortMessage?: string; message?: string };
          const detail = String(e?.details ?? e?.shortMessage ?? e?.message);
          if (attempt >= 4 || !behindNode.test(detail)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }) as typeof inner.request;
    return { ...inner, request };
  };
}
