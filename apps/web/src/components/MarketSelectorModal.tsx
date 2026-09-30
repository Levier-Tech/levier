"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { TokenLogo } from "./TokenLogo";
import type { PonsMarketEntry } from "@/lib/pons-client";
import { Search, X, ChevronDown, Check } from "lucide-react";

interface MarketSelectorModalProps {
  markets: PonsMarketEntry[];
  selectedMarket: PonsMarketEntry;
  onSelect: (market: PonsMarketEntry) => void;
}

export function MarketSelectorModal({
  markets,
  selectedMarket,
  onSelect,
}: MarketSelectorModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      setSearch("");
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Prevent background scroll when modal open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Filter markets by symbol, name, or contract address
  const filteredMarkets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return markets;

    return markets.filter((m) => {
      const matchSymbol = m.symbol.toLowerCase().includes(q);
      const matchName = m.name.toLowerCase().includes(q);
      const matchAddress = m.address.toLowerCase().includes(q);
      return matchSymbol || matchName || matchAddress;
    });
  }, [markets, search]);

  const formatPrice = (price: number) => {
    if (price < 0.0001) return price.toPrecision(4);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(2);
  };

  const truncateAddress = (addr: string) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 sm:px-3.5 sm:py-2 bg-[#141614] border border-[#2a3028] hover:border-[var(--green)] text-white rounded-lg transition-all text-left group shadow-sm max-w-full"
        aria-label="Select market asset"
      >
        <TokenLogo src={selectedMarket.image} symbol={selectedMarket.symbol} size={28} />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-base sm:text-lg tracking-tight truncate font-display">
              {selectedMarket.symbol}
            </span>
            <span className="text-[11px] text-[#9b9b99] hidden sm:inline truncate max-w-[120px]">
              {selectedMarket.name}
            </span>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#9b9b99] group-hover:text-[var(--green)] shrink-0 transition-transform ml-1" />
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm modal-fade-in"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-[#0f110e] border border-[#283124] sm:rounded-xl rounded-t-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden modal-slide-up"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="market-modal-title"
          >
            {/* Header */}
            <div className="p-4 border-b border-[#20281b] flex items-center justify-between">
              <div>
                <h3 id="market-modal-title" className="text-base font-bold text-white font-display">
                  Select Market Asset
                </h3>
                <p className="text-xs text-[#9b9b99] mt-0.5">
                  Search by name, ticker, or contract address
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-[#9b9b99] hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-[#20281b]">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-[#9b9b99] absolute left-3 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, symbol, or 0x..."
                  className="w-full bg-[#161a14] border border-[#2d3826] focus:border-[var(--green)] rounded-lg pl-9 pr-8 py-2.5 text-sm text-white placeholder:text-[#6f7568] outline-none transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 p-1 text-[#9b9b99] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Market List */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#1e251a] touch-scroll max-h-[50vh] sm:max-h-[380px]">
              {filteredMarkets.length === 0 ? (
                <div className="py-12 px-4 text-center text-[#9b9b99]">
                  <p className="text-sm font-semibold">No assets match your search</p>
                  <p className="text-xs text-[#6e7568] mt-1">
                    Try searching by contract address or another ticker
                  </p>
                </div>
              ) : (
                filteredMarkets.map((m) => {
                  const isSelected = m.symbol === selectedMarket.symbol;
                  return (
                    <button
                      key={m.address}
                      type="button"
                      onClick={() => {
                        onSelect(m);
                        setIsOpen(false);
                      }}
                      className={`w-full p-3.5 flex items-center justify-between gap-3 text-left transition-colors hover:bg-white/[0.04] ${
                        isSelected ? "bg-[var(--green)]/10" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenLogo src={m.image} symbol={m.symbol} size={36} />
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white font-display">
                              {m.symbol}
                            </span>
                            {m.eligible && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--green)]/20 text-[var(--green)] font-semibold">
                                LEVERAGE
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#9b9b99] truncate mt-0.5">
                            {m.name}
                          </div>
                          <div className="text-[10px] text-[#6e7568] font-mono mt-0.5">
                            {truncateAddress(m.address)}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-semibold text-white">
                          ${formatPrice(m.price)}
                        </div>
                        <div
                          className={`text-xs font-mono font-medium ${
                            m.change24h >= 0 ? "text-[var(--green)]" : "text-[#d6153c]"
                          }`}
                        >
                          {m.change24h >= 0 ? "+" : ""}
                          {m.change24h?.toFixed(2) || "0.00"}%
                        </div>
                      </div>

                      {isSelected && (
                        <Check className="w-4 h-4 text-[var(--green)] shrink-0 ml-1" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
