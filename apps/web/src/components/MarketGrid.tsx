"use client";

import React from "react";
import Link from "next/link";
import { assetCatalog, marketPath } from "../lib/asset-catalog";
import { MarketConfig } from "@levera/types";
import { useReferencePrices } from "../hooks/useReferencePrices";
import { EmptyPriceValue } from "./EmptyPriceValue";

interface MarketGridProps {
  markets?: MarketConfig[];
  onSelectAsset?: (ticker: string) => void;
}

const FEATURED_MARKETS = assetCatalog.filter((asset) => asset.featured);
export function MarketGrid({ markets }: MarketGridProps) {
  const references = useReferencePrices();
  return (
    <section
      className="markets-section section-wrap"
      id="markets"
      aria-labelledby="markets-title"
    >
      {/* Topline */}
      <div className="section-topline">
        <span>02 / THE ASSETS</span>
        <span>PLANNED MARKET UNIVERSE</span>
      </div>

      {/* Heading */}
      <div className="markets-heading">
        <h2 className="section-title" id="markets-title">
          Familiar names.
          <br />
          <span>New possibilities.</span>
        </h2>
        <p>Tokenized US equities at the center of your onchain portfolio.</p>
      </div>

      {/* 5-Column Grid Tiles */}
      <div className="market-strip">
        {FEATURED_MARKETS.map((asset) => {
          const price = references.price(asset.ticker);

          return (
            <Link
              key={asset.ticker}
              href={marketPath(asset.ticker)}
              className="market-tile"
            >
              <img src={asset.image} alt={asset.name} />
              <strong>{asset.ticker}</strong>
              <span>
                {price ??
                  (references.pending ? "Loading price…" : <EmptyPriceValue />)}
              </span>
              <small>Stock reference · USD</small>
              <span className="tile-arrow">↗</span>
            </Link>
          );
        })}
      </div>

      {/* Bottom Bar */}
      <div className="markets-bottom">
        <span>
          Asset availability depends on token support and market deployment.
        </span>
        <div className="flex items-center gap-6">
          <Link href="/markets" className="text-action">
            View all planned markets <span>↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
