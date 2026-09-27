import type { PublicClient } from "viem";

/** Deduplicate identical reads within one explicitly pinned snapshot only. */
export function snapshotClient(client: PublicClient): PublicClient {
  const reads = new Map<string, Promise<unknown>>();
  return new Proxy(client, {
    get(target, property) {
      if (!["getChainId", "getCode", "readContract"].includes(String(property)))
        return Reflect.get(target, property);
      return (...args: unknown[]) => {
        const key = `${String(property)}:${JSON.stringify(args, (_, value) => (typeof value === "bigint" ? `${value}n` : value))}`;
        let pending = reads.get(key);
        if (!pending) {
          const method = Reflect.get(target, property) as (
            ...values: unknown[]
          ) => Promise<unknown>;
          pending = Promise.resolve().then(() => method.apply(target, args));
          reads.set(key, pending);
        }
        return pending;
      };
    },
  });
}
