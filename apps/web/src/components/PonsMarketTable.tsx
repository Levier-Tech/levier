"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type { PonsMarketEntry } from "../lib/pons-client";
import { TokenLogo, TokenBackgroundOverlay } from "./TokenLogo";
import { useRouter } from "next/navigation";
import { PonsGraduationToast, type GraduationToastItem } from "./PonsGraduationToast";

type FilterMode = "all" | "eligible" | "graduated";

interface PonsMarketTableProps {
  markets: PonsMarketEntry[];
  onRefresh?: () => void;
  isRefetching?: boolean;
  lastUpdated?: Date | null;
}

function PonsMarketCard({
  m,
  isNew,
  priceFlash,
}: {
  m: PonsMarketEntry;
  isNew?: boolean;
  priceFlash?: "up" | "down";
}) {
  const [history, setHistory] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (m.address) {
      fetch(`/api/pons/markets/${m.address}/history`)
        .then((res) => res.json())
        .then((data) => {
          if (data.history) setHistory(data.history);
        })
        .catch(console.error);
    }
  }, [m.address]);

  return (
    <div
      className={`relative overflow-hidden rounded-[6px] border p-4 sm:p-5 flex flex-col gap-3 transition-colors ${
        m.eligible
          ? "border-[#292a27] hover:border-[#c2ff47] bg-[#111]"
          : "border-[#1f201d] bg-[#0c0d0c] opacity-80"
      } ${m.eligible ? "cursor-pointer" : ""}`}
      style={{ minHeight: "210px" }}
      onClick={() => {
        if (m.eligible) router.push(`/trade?asset=${m.symbol}`);
      }}
    >
      {/* Background Overlay */}
      <TokenBackgroundOverlay src={m.image} symbol={m.symbol} />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full gap-2">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <TokenLogo src={m.image} symbol={m.symbol} size={36} showPonsBadge />
            <div className="truncate flex flex-col justify-center">
              <h3 className="font-bold text-[14px] sm:text-[15px] text-white m-0 leading-tight truncate font-display tracking-wide">
                {m.symbol}
              </h3>
              <p className="text-[#9b9b99] text-xs m-0 truncate mt-0.5">{m.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div
              className={m.eligible ? "app-badge text-[10px]" : "app-badge border-[#292a27] !text-[#9b9b99] text-[10px]"}
            >
              {m.graduated ? "GRADUATED" : "BONDING"}
            </div>
          </div>
        </div>

        {m.description && (
          <p className="text-[#9b9b99] text-[12px] line-clamp-2 mt-1 leading-relaxed">
            {m.description}
          </p>
        )}

        <div className="flex gap-2 items-center mt-1">
          {m.websiteUrl && (
            <a
              href={m.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] border border-gray-700 rounded px-1.5 py-0.5 bg-black/50 hover:border-gray-500">
                Web
              </span>
            </a>
          )}
          {m.twitterUrl && (
            <a
              href={m.twitterUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] border border-gray-700 rounded px-1.5 py-0.5 bg-black/50 hover:border-gray-500">
                X
              </span>
            </a>
          )}
          {m.telegramUrl && (
            <a
              href={m.telegramUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] border border-gray-700 rounded px-1.5 py-0.5 bg-black/50 hover:border-gray-500">
                TG
              </span>
            </a>
          )}
          {m.discordUrl && (
            <a
              href={m.discordUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] border border-gray-700 rounded px-1.5 py-0.5 bg-black/50 hover:border-gray-500">
                DC
              </span>
            </a>
          )}
        </div>

        <div className="mt-auto pt-3 rounded-lg backdrop-blur-xl bg-black/40 border border-white/10 p-3 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[#9b9b99] text-[11px] m-0 mb-1 uppercase tracking-widest font-bold">Price</p>
              <p
                className={`tabular-nums text-sm m-0 transition-all rounded inline-block ${
                  priceFlash === "up"
                    ? "text-[#c2ff47] font-bold drop-shadow-md"
                    : priceFlash === "down"
                    ? "text-red-400 font-bold drop-shadow-md"
                    : "text-white drop-shadow"
                }`}
              >
                ${m.price > 0 ? m.price.toPrecision(4) : "N/A"}
                {priceFlash === "up" && <span className="ml-1 text-xs text-[#c2ff47]">↑</span>}
                {priceFlash === "down" && <span className="ml-1 text-xs text-red-400">↓</span>}
              </p>
            </div>
            <div>
              <p className="text-[#9b9b99] text-[11px] m-0 mb-1 uppercase tracking-widest font-bold">Market Cap</p>
              <p className="text-white tabular-nums text-sm m-0 drop-shadow">
                $
                {m.marketCap > 0
                  ? m.marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })
                  : "N/A"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PonsMarketTable({
  markets,
  onRefresh,
  isRefetching,
  lastUpdated,
}: PonsMarketTableProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Track initial load vs newly arrived addresses
  const initialAddressesRef = useRef<Set<string> | null>(null);
  const [newTokensSet, setNewTokensSet] = useState<Set<string>>(new Set());
  const [toastQueue, setToastQueue] = useState<GraduationToastItem[]>([]);

  // Track price movement flashes (green up / red down)
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  const [priceFlashMap, setPriceFlashMap] = useState<Record<string, "up" | "down">>({});

  // Human-readable time elapsed
  const [timeAgo, setTimeAgo] = useState<string>("just now");

  useEffect(() => {
    const updateTick = () => {
      if (!lastUpdated) {
        setTimeAgo("just now");
        return;
      }
      const diffSec = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (diffSec < 4) {
        setTimeAgo("just now");
      } else if (diffSec < 60) {
        setTimeAgo(`${diffSec}s ago`);
      } else {
        const mins = Math.floor(diffSec / 60);
        setTimeAgo(`${mins}m ago`);
      }
    };

    updateTick();
    const interval = setInterval(updateTick, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // Detect newly added tokens & price changes on market updates
  useEffect(() => {
    if (markets.length === 0) return;

    // 1. Check for newly arrived tokens
    if (!initialAddressesRef.current) {
      initialAddressesRef.current = new Set(markets.map((m) => m.address.toLowerCase()));
    } else {
      const newlyArrived: string[] = [];
      for (const m of markets) {
        const addr = m.address.toLowerCase();
        if (!initialAddressesRef.current.has(addr)) {
          newlyArrived.push(addr);
          initialAddressesRef.current.add(addr);
        }
      }

      if (newlyArrived.length > 0) {
        setNewTokensSet((prev) => {
          const next = new Set(prev);
          newlyArrived.forEach((a) => next.add(a));
          return next;
        });

        // Filter unique by address in case the markets array contains duplicates
        const uniqueAddresses = new Set<string>();
        const newToasts: GraduationToastItem[] = [];
        
        markets.forEach((m) => {
          const addr = m.address.toLowerCase();
          // STRICT FILTER: Only show toast for tokens that have at least $1M Market Cap
          if (newlyArrived.includes(addr) && !uniqueAddresses.has(addr) && m.marketCap >= 1000000) {
            uniqueAddresses.add(addr);
            newToasts.push({
              id: m.address,
              name: m.name,
              symbol: m.symbol,
              image: m.image,
            });
          }
        });

        if (newToasts.length > 0) {
          setToastQueue((prev) => {
            // Further deduplicate against existing queue
            const existingIds = new Set(prev.map((t) => t.id.toLowerCase()));
            const reallyNewToasts = newToasts.filter((t) => !existingIds.has(t.id.toLowerCase()));
            return [...prev, ...reallyNewToasts];
          });
        }
      }
    }

    // 2. Check for price changes
    const priceUpdates: Record<string, "up" | "down"> = {};
    let hasPriceUpdate = false;

    markets.forEach((m) => {
      const key = m.address.toLowerCase();
      const prevPrice = prevPricesRef.current.get(key);
      if (prevPrice !== undefined && m.price > 0 && prevPrice > 0) {
        if (m.price > prevPrice) {
          priceUpdates[key] = "up";
          hasPriceUpdate = true;
        } else if (m.price < prevPrice) {
          priceUpdates[key] = "down";
          hasPriceUpdate = true;
        }
      }
      prevPricesRef.current.set(key, m.price);
    });

    if (hasPriceUpdate) {
      setPriceFlashMap((prev) => ({ ...prev, ...priceUpdates }));
      const timer = setTimeout(() => {
        setPriceFlashMap((prev) => {
          const next = { ...prev };
          Object.keys(priceUpdates).forEach((k) => delete next[k]);
          return next;
        });
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [markets]);

  const filtered = useMemo(() => {
    let list = [...markets];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.symbol.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q)
      );
    }

    if (filter === "eligible") {
      list = list.filter((m) => m.eligible);
    } else if (filter === "graduated") {
      list = list.filter((m) => m.graduated);
    }

    return list;
  }, [markets, search, filter]);

  const handleDismissToasts = useCallback(() => setToastQueue([]), []);

  return (
    <div className="pons-discovery flex flex-col gap-6">
      {/* Stacked Toast Notifications */}
      <PonsGraduationToast queue={toastQueue} onDismissAll={handleDismissToasts} />
      {/* Real-time Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 rounded-[6px] bg-[#111] border border-[#292a27] text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#c2ff47] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#c2ff47]"></span>
            </span>
            <span className="font-semibold text-[#f4f4f0]">Robinhood Chain Live Polling</span>
          </div>
          <span className="text-[#9b9b99] hidden sm:inline">•</span>
          <span className="text-[#9b9b99] hidden sm:inline">Every 15s</span>
          <span className="text-[#9b9b99] hidden md:inline">•</span>
          <span className="text-[#9b9b99] hidden md:inline">
            Last check: <strong className="text-[#f4f4f0] font-sans">{timeAgo}</strong>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[#9b9b99]">
            Total: <strong className="text-[#c2ff47] font-sans">{markets.length}</strong> assets
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] bg-transparent text-[#f4f4f0] border border-[#292a27] hover:border-[#c2ff47] transition-colors disabled:opacity-50"
              title="Sync with Robinhood Chain now"
            >
              <svg
                className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin text-[#c2ff47]" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>{isRefetching ? "Syncing..." : "Sync Now"}</span>
            </button>
          )}
        </div>
      </div>


      {/* Controls */}
      <div className="pons-controls flex flex-col sm:flex-row gap-3 sm:gap-4 justify-between items-stretch sm:items-center bg-[#111] p-3.5 sm:p-5 rounded-[6px] border border-[#292a27]">
        <input
          id="pons-search"
          className="pons-search bg-[#080808] border border-[#292a27] rounded-[4px] px-3.5 py-2 sm:px-4 sm:py-2.5 text-white text-sm w-full sm:w-64 focus:outline-none focus:border-[#c2ff47]"
          type="text"
          placeholder="Search tokens..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search Pons markets"
        />
        <div className="pons-filters flex gap-1 sm:gap-2 border-b border-[#292a27] pb-1 overflow-x-auto no-scrollbar" role="radiogroup" aria-label="Filter markets">
          {(["all", "eligible", "graduated"] as FilterMode[]).map((f) => (
            <button
              key={f}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-sm text-[10px] sm:text-[11px] uppercase tracking-widest font-bold whitespace-nowrap transition-all ${
                filter === f
                  ? "bg-transparent text-[#c2ff47] border-b-2 border-[#c2ff47]"
                  : "bg-transparent text-[#9b9b99] hover:text-[#f4f4f0]"
              }`}
              onClick={() => setFilter(f)}
              role="radio"
              aria-checked={filter === f}
            >
              {f === "all" ? "All" : f === "eligible" ? "Eligible" : "Graduated"}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-all duration-500">
        {filtered.length === 0 ? (
          <div className="col-span-full p-12 text-center text-gray-500 border border-dashed border-gray-800 rounded-xl">
            {search.trim()
              ? "No markets match your search."
              : "No graduated assets found."}
          </div>
        ) : (
          filtered.map((m) => (
            <PonsMarketCard
              key={m.address}
              m={m}
              isNew={newTokensSet.has(m.address.toLowerCase())}
              priceFlash={priceFlashMap[m.address.toLowerCase()]}
            />
          ))
        )}
      </div>
    </div>
  );
}
