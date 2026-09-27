"use client";

import React, { useEffect, useRef } from "react";
import { useReferencePrices } from "../hooks/useReferencePrices";
import { EmptyPriceValue } from "./EmptyPriceValue";
import { useRouter } from "next/navigation";
import { assetCatalog, marketPath } from "../lib/asset-catalog";
import { MarketConfig } from "@levier/types";

interface StockCardSceneProps {
  markets?: MarketConfig[];
  onSelectAsset?: (ticker: string) => void;
}

const STOCK_ASSETS = assetCatalog;

export function StockCardScene({
  markets,
  onSelectAsset,
}: StockCardSceneProps) {
  const router = useRouter();
  const references = useReferencePrices();
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let phase = 0;
    let frameId = 0;
    let pointerX = 0;

    const cards = cardRefs.current.filter(Boolean) as HTMLDivElement[];
    if (cards.length === 0) return;

    function drawCards() {
      if (!scene) return;
      const width = scene.clientWidth;
      const radius = Math.min(width * 0.285, 310);

      cards.forEach((card, i) => {
        const theta = (i / cards.length) * Math.PI * 2 + phase;
        const x = Math.sin(theta) * radius;
        const depth = Math.cos(theta);
        const y = Math.sin(theta * 2 + phase * 0.25) * 12;
        const scale = 0.78 + (depth + 1) * 0.13;
        const angle = Math.sin(theta) * -33;

        card.style.transform = `translate3d(${
          x + pointerX * (depth + 1)
        }px, ${y}px, 0) rotateY(${angle}deg) rotateZ(${
          Math.sin(theta) * 3
        }deg) scale(${scale})`;
        card.style.zIndex = String(Math.round((depth + 1) * 100));
        card.style.filter = `brightness(${0.66 + (depth + 1) * 0.17})`;
      });
    }

    function animate(time: number) {
      phase = time * 0.00013;
      drawCards();
      frameId = requestAnimationFrame(animate);
    }

    function handlePointerMove(event: PointerEvent) {
      if (!scene) return;
      const rect = scene.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
    }

    function handlePointerLeave() {
      pointerX = 0;
    }

    scene.addEventListener("pointermove", handlePointerMove);
    scene.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("resize", drawCards);

    // Initial draw
    drawCards();

    if (!prefersReducedMotion) {
      frameId = requestAnimationFrame(animate);
    }

    return () => {
      cancelAnimationFrame(frameId);
      scene.removeEventListener("pointermove", handlePointerMove);
      scene.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("resize", drawCards);
    };
  }, []);

  const handleCardClick = (ticker: string) => {
    if (onSelectAsset) {
      onSelectAsset(ticker);
    } else if (typeof window !== "undefined") {
      router.push(marketPath(ticker));
    }
  };

  return (
    <div
      ref={sceneRef}
      className="stock-scene"
      aria-label="Animated collection of US stock logos"
    >
      <div className="stock-stage">
        {STOCK_ASSETS.map((asset, idx) => {
          const displayPrice = references.price(asset.ticker);

          return (
            <div
              key={asset.ticker}
              ref={(el) => {
                cardRefs.current[idx] = el;
              }}
              className={`stock-card ${asset.className} cursor-pointer transition-shadow hover:shadow-2xl`}
              data-card={idx}
              onClick={() => handleCardClick(asset.ticker)}
              role="button"
              aria-label={`View ${asset.name} market`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick(asset.ticker);
                }
              }}
            >
              <div className="card-top">
                <span>{asset.ticker}</span>
                <span>{asset.indexStr}</span>
              </div>

              {/* Asset Logo SVG */}
              {/* Using standard img for exact SVG styling from styles.css */}
              <img src={asset.image} alt={asset.name} />

              <div className="card-bottom">
                <div className="card-quote">
                  <span>
                    {displayPrice ??
                      (references.pending ? (
                        "Loading price…"
                      ) : (
                        <EmptyPriceValue />
                      ))}
                  </span>
                  <small>Stock reference · USD</small>
                </div>
                <span>↗</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
