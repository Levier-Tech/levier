"use client";
import { useQuery } from "@tanstack/react-query";
import { env } from "../env.mjs";
import {
  referencePricesSchema,
  displayReferencePrice,
} from "../lib/reference-prices";
export function useReferencePrices() {
  const query = useQuery({
    queryKey: ["stock-reference-prices", env.CHAIN_ID],
    queryFn: async () => {
      const r = await fetch("/api/reference-prices", { cache: "no-store" });
      if (!r.ok) throw Error("Reference unavailable");
      return referencePricesSchema.parse(await r.json());
    },
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  return {
    price: (symbol: string) =>
      query.isError
        ? null
        : displayReferencePrice(query.data, symbol, Date.now()),
    pending: query.isPending,
  };
}
