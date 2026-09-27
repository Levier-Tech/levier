"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import type { MarketConfig, NetworkMode } from "@levier/types";
import { fetchMarkets } from "../lib/api";
import { env } from "../env.mjs";
import { useSmartPolling } from "./useSmartPolling";
import { assetCatalog } from "../lib/asset-catalog";
const supportedSymbols = new Set(assetCatalog.map((asset) => asset.ticker));
export function useLevierMarkets(networkMode: NetworkMode) {
  const [markets, setMarkets] = useState<MarketConfig[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const rows = await fetchMarkets(networkMode);
      if (id === request.current) {
        setMarkets(
          rows.filter((market) => supportedSymbols.has(market.assetSymbol)),
        );
        setError(null);
      }
    } catch {
      if (id === request.current) {
        setMarkets([]);
        setError("Market data unavailable");
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [networkMode]);
  useEffect(() => {
    setMarkets([]);
    setLoading(true);
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useSmartPolling(load, env.UI_POLL_INTERVAL_MS);
  return { markets, isLoading, error, refetch: load };
}
