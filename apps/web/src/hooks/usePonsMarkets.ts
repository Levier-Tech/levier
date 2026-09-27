"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { fetchPonsMarkets, type PonsMarketEntry } from "../lib/pons-client";
import { useSmartPolling } from "./useSmartPolling";
import { env } from "../env.mjs";

/**
 * Hook for fetching and polling Pons graduated markets.
 * Follows the same pattern as useLevierMarkets.
 */
export function usePonsMarkets() {
  const [markets, setMarkets] = useState<PonsMarketEntry[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setIsRefetching(true);
    try {
      const rows = await fetchPonsMarkets();
      if (id === request.current) {
        setMarkets(rows);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch {
      if (id === request.current) {
        setMarkets([]);
        setError("Pons market data unavailable");
      }
    } finally {
      if (id === request.current) {
        setLoading(false);
        setIsRefetching(false);
      }
    }
  }, []);

  useEffect(() => {
    setMarkets([]);
    setLoading(true);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  useSmartPolling(load, 5000);

  return { markets, isLoading, isRefetching, error, refetch: load, lastUpdated };
}
