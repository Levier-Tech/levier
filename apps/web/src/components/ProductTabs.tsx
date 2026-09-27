"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { marketPath } from "../lib/asset-catalog";
import { MarketConfig, VaultConfig } from "@levier/types";

interface ProductTabsProps {
  markets?: MarketConfig[];
  vaults?: VaultConfig[];
  onSelectMarket?: (asset: string) => void;
}

type TabType = "borrow" | "earn" | "leverage";

export function ProductTabs({
  markets,
  vaults,
  onSelectMarket,
}: ProductTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("borrow");
  const [selectedLeverage, setSelectedLeverage] = useState<number>(2.0);
  const tabListRef = useRef<HTMLDivElement>(null);

  // Listen for global tab switch events (from Header or Hero)
  useEffect(() => {
    function handleCustomSelect(e: Event) {
      const customEvent = e as CustomEvent<{ tab: TabType }>;
      if (customEvent.detail && customEvent.detail.tab) {
        setActiveTab(customEvent.detail.tab);
      }
    }
    window.addEventListener("select-product-tab", handleCustomSelect);
    return () =>
      window.removeEventListener("select-product-tab", handleCustomSelect);
  }, []);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentTab: TabType,
  ) => {
    const tabs: TabType[] = ["borrow", "earn", "leverage"];
    let nextIndex = tabs.indexOf(currentTab);

    if (event.key === "ArrowRight") {
      nextIndex = (nextIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (nextIndex + tabs.length - 1) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab);

    // Focus the target tab
    const buttons = tabListRef.current?.querySelectorAll("button");
    if (buttons && buttons[nextIndex]) {
      buttons[nextIndex].focus();
    }
  };

  const router = useRouter();
  const openMarket = (asset: string) => {
    if (onSelectMarket) onSelectMarket(asset);
    else router.push(marketPath(asset));
  };

  // Find TSLA or AMZN market for live preview numbers
  const tslaMarket = markets?.find(
    (m) =>
      (m.assetSymbol && m.assetSymbol.toUpperCase() === "TSLA") ||
      (m.name && m.name.toUpperCase().includes("TSLA")),
  );
  const amznMarket = markets?.find(
    (m) =>
      (m.assetSymbol && m.assetSymbol.toUpperCase() === "AMZN") ||
      (m.name && m.name.toUpperCase().includes("AMZN")),
  );
  const primaryVault = vaults && vaults.length > 0 ? vaults[0] : null;

  return (
    <section
      className="products section-wrap"
      id="products"
      aria-labelledby="products-title"
    >
      {/* Section Topline */}
      <div className="section-topline">
        <span>01 / THE POSSIBILITIES</span>
        <span>MORE FROM WHAT YOU HOLD</span>
      </div>

      {/* Title */}
      <h2 className="section-title" id="products-title">
        Holding is just
        <br />
        the <span>beginning.</span>
      </h2>

      <div className="product-layout">
        {/* LEFT COLUMN: TABS & CONTENT */}
        <div className="product-left">
          <div
            ref={tabListRef}
            className="product-tabs"
            role="tablist"
            aria-label="Levier products"
          >
            <button
              id="tab-borrow"
              role="tab"
              aria-selected={activeTab === "borrow"}
              aria-controls="panel-borrow"
              tabIndex={activeTab === "borrow" ? 0 : -1}
              onClick={() => setActiveTab("borrow")}
              onKeyDown={(e) => handleKeyDown(e, "borrow")}
            >
              Borrow
            </button>
            <button
              id="tab-earn"
              role="tab"
              aria-selected={activeTab === "earn"}
              aria-controls="panel-earn"
              tabIndex={activeTab === "earn" ? 0 : -1}
              onClick={() => setActiveTab("earn")}
              onKeyDown={(e) => handleKeyDown(e, "earn")}
            >
              Earn
            </button>
            <button
              id="tab-leverage"
              role="tab"
              aria-selected={activeTab === "leverage"}
              aria-controls="panel-leverage"
              tabIndex={activeTab === "leverage" ? 0 : -1}
              onClick={() => setActiveTab("leverage")}
              onKeyDown={(e) => handleKeyDown(e, "leverage")}
            >
              Leverage
            </button>
          </div>

          {/* PANEL: BORROW */}
          {activeTab === "borrow" && (
            <article
              className="product-panel"
              id="panel-borrow"
              role="tabpanel"
              aria-labelledby="tab-borrow"
            >
              <span className="product-index">01</span>
              <h3>
                Keep the asset.
                <br />
                Unlock the liquidity.
              </h3>
              <p>
                Use tokenized equities as collateral to access stablecoins. See
                your loan-to-value ratio and position health in one place.
              </p>
              <button
                type="button"
                className="text-action"
                onClick={() => openMarket("TSLA")}
              >
                Explore collateral markets <span>↗</span>
              </button>
            </article>
          )}

          {/* PANEL: EARN */}
          {activeTab === "earn" && (
            <article
              className="product-panel"
              id="panel-earn"
              role="tabpanel"
              aria-labelledby="tab-earn"
            >
              <span className="product-index">02</span>
              <h3>
                Put your stablecoins
                <br />
                to work.
              </h3>
              <p>
                Supply stablecoins to lending vaults. Earn from borrower
                interest, with a clear view of each vault's assets and risks.
              </p>
              <Link href="/earn" className="text-action">
                Explore lending vaults <span>↗</span>
              </Link>
            </article>
          )}

          {/* PANEL: LEVERAGE */}
          {activeTab === "leverage" && (
            <article
              className="product-panel"
              id="panel-leverage"
              role="tabpanel"
              aria-labelledby="tab-leverage"
            >
              <span className="product-index">03</span>
              <h3>
                Your conviction.
                <br />
                Your exposure.
              </h3>
              <p>
                Go long, go short, or multiply a position. Manage exposure and
                monitor liquidation levels from a single interface.
              </p>
              <Link href="/trade" className="text-action">
                Explore equity markets <span>↗</span>
              </Link>
            </article>
          )}
        </div>

        {/* RIGHT COLUMN: PREVIEW PANEL */}
        <div
          className="product-visual"
          aria-label="Illustrative Levier product interface"
        >
          <div className="preview-top">
            <span>LEVIER</span>
            <span className="preview-badge">
              {activeTab === "borrow" && tslaMarket
                ? "LIVE MARKET PREVIEW"
                : "ILLUSTRATIVE PREVIEW"}
            </span>
          </div>

          {/* VISUAL: BORROW */}
          {activeTab === "borrow" && (
            <div id="example-borrow" className="example">
              <div className="example-heading">
                <div className="asset-icon">
                  <img src="/assets/tesla.svg" alt="Tesla" />
                </div>
                <div>
                  <strong>TSLA collateral</strong>
                  <span>Tokenized equity</span>
                </div>
                <span className="tag">Borrow</span>
              </div>

              <div className="balance">
                <span>Collateral value</span>
                <strong>
                  {tslaMarket?.markPrice
                    ? `$${(Number(tslaMarket.markPrice) * 40).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "$10,000"}
                  <span>.00</span>
                </strong>
              </div>

              <div className="example-row">
                <span>Example borrow amount</span>
                <strong>
                  {tslaMarket?.markPrice
                    ? `$${(Number(tslaMarket.markPrice) * 12).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "$3,000.00"}
                </strong>
              </div>

              <div className="example-row">
                <span>Loan-to-value</span>
                <strong>30.0%</strong>
              </div>

              <div className="meter">
                <i style={{ width: "30%" }}></i>
              </div>

              <div className="meter-label">
                <span>Current LTV</span>
                <span>30%</span>
              </div>

              <p className="example-note">
                {tslaMarket
                  ? "Real-time collateral reference from Robinhood Chain oracle."
                  : "Illustrative values. Market limits and rates are not live."}
              </p>
            </div>
          )}

          {/* VISUAL: EARN */}
          {activeTab === "earn" && (
            <div id="example-earn" className="example">
              <div className="example-heading">
                <div className="asset-icon dollar">$</div>
                <div>
                  <strong>Levier USD Vault</strong>
                  <span>Stablecoin lending</span>
                </div>
                <span className="tag">Earn</span>
              </div>

              <div className="balance">
                <span>Example deposit</span>
                <strong>
                  $5,000<span>.00</span>
                </strong>
              </div>

              <div className="example-row">
                <span>Yield source</span>
                <strong>Borrower interest</strong>
              </div>

              <div className="example-row">
                <span>Vault focus</span>
                <strong>Tokenized equities</strong>
              </div>

              <div className="vault-assets">
                <span>TSLA</span>
                <span>AMZN</span>
                <span>PLTR</span>
              </div>

              <p className="example-note">
                {primaryVault
                  ? "ERC-4626 standard yield vault deployed on Robinhood Chain."
                  : "Illustrative vault. Deposits and live rates are not enabled."}
              </p>
            </div>
          )}

          {/* VISUAL: LEVERAGE */}
          {activeTab === "leverage" && (
            <div id="example-leverage" className="example">
              <div className="example-heading">
                <div className="asset-icon">
                  <img src="/assets/amazon.svg" alt="Amazon" />
                </div>
                <div>
                  <strong>AMZN exposure</strong>
                  <span>Tokenized equity</span>
                </div>
                <span className="tag">Long</span>
              </div>

              <div className="balance">
                <span>Example position exposure</span>
                <strong>
                  $
                  {(1000 * selectedLeverage).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>

              <div className="example-row">
                <span>Your initial equity</span>
                <strong>$1,000.00</strong>
              </div>

              <div className="example-row">
                <span>Example leverage</span>
                <strong className="green">
                  {selectedLeverage.toFixed(1)}×
                </strong>
              </div>

              <div className="leverage-scale">
                <button
                  type="button"
                  onClick={() => setSelectedLeverage(1.0)}
                  className={`px-3 py-2 rounded text-xs border transition-colors ${
                    selectedLeverage === 1.0
                      ? "border-[var(--green)] text-[var(--green)] bg-[#252e1c]"
                      : "border-[#38472a] bg-[#252e1c] text-white hover:border-[#4d6139]"
                  }`}
                >
                  1×
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedLeverage(2.0)}
                  className={`px-3 py-2 rounded text-xs border transition-colors ${
                    selectedLeverage === 2.0
                      ? "border-[var(--green)] text-[var(--green)] bg-[#252e1c]"
                      : "border-[#38472a] bg-[#252e1c] text-white hover:border-[#4d6139]"
                  }`}
                >
                  2×
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedLeverage(2.5)}
                  className={`px-3 py-2 rounded text-xs border transition-colors ${
                    selectedLeverage === 2.5
                      ? "border-[var(--green)] text-[var(--green)] bg-[#252e1c]"
                      : "border-[#38472a] bg-[#252e1c] text-white hover:border-[#4d6139]"
                  }`}
                >
                  2.5×
                </button>
              </div>

              <p className="example-note">
                1-click leverage router with automated debt swap and stop loss.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
