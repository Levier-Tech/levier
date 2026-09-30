"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PositionList } from "@/components/PositionList";
import { ponsClient } from "@/lib/pons-client";
import type { PonsMarketEntry, OracleStatus } from "@/lib/pons-client";
import { OracleHealthIndicator } from "@/components/OracleHealthIndicator";
import { TradingViewChart } from "@/components/TradingViewChart";
import { TokenLogo } from "@/components/TokenLogo";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { toast, Toaster } from "react-hot-toast";
import ERC20ABI from "@/lib/contracts/TestnetERC20.json";
import { MarketSelectorModal } from "@/components/MarketSelectorModal";
import { AppPage } from "@/components/AppPage";
import { MarginTradePanel } from "@/components/MarginTradePanel";
import { marketDeployments } from "@/lib/market-deployments";

// Configured stock / USDG markets trade through the margin router; anything else falls back to the Pons workspace.
export default function TradePage() {
  const searchParams = useSearchParams();
  const asset = (searchParams.get("asset") || searchParams.get("assets") || "").toUpperCase();
  const configured = asset
    ? marketDeployments.find((row) => row.symbol.toUpperCase() === asset)
    : marketDeployments.find((row) => row.enabled);
  if (configured)
    return (
      <AppPage
        eyebrow={`${configured.symbol} / USDG`}
        title="Trade with USDG margin."
        description="Open or close a Long or Short position. Quotes include swap fees and price impact; stale prices or paused markets block new exposure."
      >
        <MarginTradePanel market={configured} />
      </AppPage>
    );
  return <PonsTradeWorkspace />;
}

function PonsTradeWorkspace() {
  const searchParams = useSearchParams();
  const assetQuery = searchParams.get("asset") || searchParams.get("assets");
  
  const [allMarkets, setAllMarkets] = useState<PonsMarketEntry[]>([]);
  const [market, setMarket] = useState<PonsMarketEntry | null>(null);
  const [oracleStatus, setOracleStatus] = useState<OracleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<any[]>([]);
  
  // Order state
  const [isLong, setIsLong] = useState(true);
  const [collateral, setCollateral] = useState<string>("");
  const [leverage, setLeverage] = useState<number>(2);
  const [isBridging, setIsBridging] = useState(false);
  const [optimisticPositions, setOptimisticPositions] = useState<any[]>([]);

  // Wagmi hooks
  const { address: accountAddress } = useAccount();
  const { writeContract, data: hash, isPending, error: writeError, isSuccess } = useWriteContract();

  useEffect(() => {
    async function loadData() {
      try {
        const [markets, statuses] = await Promise.all([
          ponsClient.getMarkets(),
          ponsClient.getOracleStatus()
        ]);
        
        setAllMarkets(markets);

        let currentMarket: PonsMarketEntry | undefined;
        if (assetQuery) {
          currentMarket = markets.find(m => m.symbol.toUpperCase() === assetQuery.toUpperCase());
        }
        
        // Fallback if asset was not specified or not found:
        if (!currentMarket && markets.length > 0) {
          currentMarket = markets.find(m => m.eligible) || markets.find(m => m.graduated) || markets[0];
        }

        if (currentMarket) {
          setMarket(currentMarket);
          // If we used a fallback (assetQuery didn't match), update the URL to reflect it
          if (!assetQuery || currentMarket.symbol.toUpperCase() !== assetQuery.toUpperCase()) {
            window.history.replaceState(null, "", `/trade?asset=${currentMarket.symbol}`);
          }
        }
        
        if (Array.isArray(statuses)) {
          const targetSymbol = (currentMarket?.symbol || assetQuery || "").toUpperCase();
          const status = statuses.find(s => s.asset.toUpperCase() === targetSymbol);
          if (status) setOracleStatus(status);
        }
      } catch (err) {
        console.error("Failed to load trade data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [assetQuery]);

  useEffect(() => {
    if (market?.address) {
      fetch(`/api/pons/markets/${market.address}/history`)
        .then(res => res.json())
        .then(data => {
          if (data.history && data.history.length > 0) {
            setChartData(data.history);
          } else if (market.price > 0) {
            const now = Math.floor(Date.now() / 1000);
            setChartData([
              { time: now - 3600, value: market.price },
              { time: now, value: market.price }
            ]);
          }
        })
        .catch(console.error);
    }
  }, [market?.address, market?.price]);

  useEffect(() => {
    if (isPending) {
      toast.loading("Confirming in wallet...", { id: "tx" });
    }
    if (isSuccess && hash && market) {
      toast.success(
        <div>
          Trade executed successfully!<br/>
          <span className="text-xs">Tx: {hash?.slice(0,10)}...</span>
        </div>, 
        { id: "tx", duration: 5000 }
      );
      
      const collatNum = parseFloat(collateral || "0");
      const sizeUsd = collatNum * leverage;
      
      const newPos = {
        id: `pos-${market.symbol}-${Date.now()}`,
        asset: market.symbol,
        isLong,
        sizeUsd,
        collateralUsd: collatNum,
        leverage,
        entryPrice: market.price,
        markPrice: market.price,
        liquidationPrice: market.price * (isLong ? (1 - (1/leverage)*0.95) : (1 + (1/leverage)*0.95)),
        pnlUsd: 0,
        pnlPercentage: 0
      };
      setOptimisticPositions(prev => [newPos, ...prev]);
    }
  }, [isPending, isSuccess, hash, market, collateral, leverage, isLong]);

  useEffect(() => {
    if (writeError) {
      toast.error(`Error: User rejected or contract reverted`, { id: "tx", duration: 5000 });
    }
  }, [writeError]);

  function formatPrice(price: number) {
    if (price < 0.0001) return price.toPrecision(4);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(2);
  }

  function formatCompactNumber(num: number = 0) {
    if (!num || isNaN(num)) return "0.00";
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toFixed(2);
  }

  if (loading) {
    return (
      <div className="trade-page flex flex-col items-center justify-center min-h-[40vh] text-center">
        <div className="w-8 h-8 border-2 border-[var(--green)] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-[var(--muted)] text-sm font-mono">Loading market data...</p>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="trade-page flex flex-col items-center justify-center min-h-[40vh] text-center">
        <p className="text-white text-base font-bold mb-2">Market not found</p>
        <p className="text-[var(--muted)] text-sm mb-4">No active market found for {assetQuery || "requested asset"}.</p>
        <a href="/trade" className="px-4 py-2 bg-[var(--green)] text-black rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
          Return to Trade
        </a>
      </div>
    );
  }

  const collatNum = parseFloat(collateral) || 0;
  const positionSize = collatNum * leverage;
  const liqPrice = isLong 
    ? market.price * (1 - (1 / leverage) * 0.95)
    : market.price * (1 + (1 / leverage) * 0.95); // Placeholder for short

  const activeOracleStatus = oracleStatus || {
    asset: market.symbol,
    primaryPrice: market.price,
    twapPrice: market.price,
    isSafe: true,
    deviationBps: 0,
    lastUpdate: Date.now(),
    status: "HEALTHY",
  };

  const handleExecute = async () => {
    if (!accountAddress) {
      toast.error("Please connect your wallet first (e.g. MetaMask)");
      return;
    }
    
    setIsBridging(true);
    let targetAddress = market.address;
    
    try {
      if (market.coingeckoId) {
        toast.loading("Initializing secure trading channel...", { id: "bridge" });
        const res = await fetch("/api/bridge/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coingeckoId: market.coingeckoId,
            symbol: market.symbol,
            name: market.name,
            price: market.price
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        targetAddress = data.address;
        toast.success("Trading channel active!", { id: "bridge", duration: 2000 });
      }

      toast.loading("Confirm transaction in wallet...", { id: "tx" });
      
      // Simulate trade by approving the collateral amount
      writeContract({
        address: targetAddress as `0x${string}`,
        abi: ERC20ABI.abi,
        functionName: 'approve',
        args: [targetAddress as `0x${string}`, parseUnits(collateral || "0", 18)],
      });

    } catch (e: any) {
      toast.error(e.message, { id: "tx" });
      toast.dismiss("bridge");
    } finally {
      setIsBridging(false);
    }
  };

  return (
    <div className="trade-page">
      <Toaster position="top-right" />
      <div className="trade-header">
        <div className="market-info flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
            {allMarkets.length > 1 ? (
              <MarketSelectorModal
                markets={allMarkets}
                selectedMarket={market}
                onSelect={(selected) => {
                  setMarket(selected);
                  window.history.replaceState(null, "", `/trade?asset=${selected.symbol}`);
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <TokenLogo src={market.image} symbol={market.symbol} size={32} />
                <h1 className="font-bold text-lg font-display tracking-tight">{market.symbol}/USD</h1>
              </div>
            )}
            <div className="price-display">
              <span className="price font-mono">${formatPrice(market.price)}</span>
              <span className={`change ${market.change24h >= 0 ? "pons-positive" : "pons-negative"}`}>
                {market.change24h >= 0 ? "+" : ""}{market.change24h?.toFixed(2) || "0.00"}%
              </span>
            </div>

            {/* Quick Market Stats to fill width & eliminate dead empty space */}
            <div className="hidden sm:flex items-center gap-4 lg:gap-6 border-l border-[#262c22] pl-3 sm:pl-4 text-xs">
              <div>
                <span className="text-[#888884] block text-[10px] uppercase font-mono tracking-wider">24h Vol</span>
                <span className="font-mono font-medium text-white">${formatCompactNumber(market.volume24h)}</span>
              </div>
              <div>
                <span className="text-[#888884] block text-[10px] uppercase font-mono tracking-wider">Liquidity</span>
                <span className="font-mono font-medium text-white">${formatCompactNumber(market.liquidity)}</span>
              </div>
              <div>
                <span className="text-[#888884] block text-[10px] uppercase font-mono tracking-wider">Max Lev</span>
                <span className="font-mono font-semibold text-[var(--green)]">{market.maxLeverage || 10}x</span>
              </div>
            </div>
          </div>
          <OracleHealthIndicator status={activeOracleStatus as any} />
        </div>
      </div>

      <div className="trade-content">
        <div className="chart-area">
          <div className="chart-wrapper">
            {chartData.length > 0 ? (
              <TradingViewChart data={chartData} />
            ) : (
              <div className="chart-placeholder">
                <span>Loading Chart for {market.symbol}...</span>
              </div>
            )}
          </div>
        </div>

        <div className="order-panel">
          <div className="order-tabs">
            <button 
              className={`tab ${isLong ? "active long" : ""}`}
              onClick={() => setIsLong(true)}
            >
              LONG
            </button>
            <button 
              className={`tab ${!isLong ? "active short" : ""}`}
              onClick={() => setIsLong(false)}
            >
              SHORT
            </button>
          </div>

          <div className="input-group">
            <label>Collateral (USD)</label>
            <div className="input-wrapper">
              <input 
                type="number" 
                value={collateral}
                onChange={e => setCollateral(e.target.value)}
                placeholder="0.00"
              />
              <span className="currency">USDG</span>
            </div>
          </div>

          <div className="input-group">
            <div className="flex justify-between items-center mb-1">
              <label className="!mb-0">Leverage</label>
              <span className="font-mono text-sm font-semibold text-[var(--green)]">{leverage.toFixed(1)}x</span>
            </div>
            <input 
              type="range" 
              min="1.1" 
              max={market.maxLeverage || 10} 
              step="0.1" 
              value={leverage}
              onChange={e => setLeverage(parseFloat(e.target.value))}
              className="leverage-slider"
            />
          </div>

          <div className="order-summary">
            <div className="summary-row">
              <span>Position Size</span>
              <span>${positionSize.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Entry Price</span>
              <span>${formatPrice(market.price)}</span>
            </div>
            <div className="summary-row">
              <span>Liq. Price</span>
              <span style={{ color: "#ff6b6b" }}>${formatPrice(liqPrice)}</span>
            </div>
          </div>

          <button 
            className={`submit-btn ${isLong ? "long" : "short"}`}
            disabled={collatNum <= 0 || !activeOracleStatus.isSafe || isPending || isBridging}
            onClick={handleExecute}
          >
            {isBridging ? "Initializing..." 
              : isPending ? "Confirm in Wallet" 
              : collatNum <= 0 ? "Enter Amount" 
              : !activeOracleStatus.isSafe ? "Oracle Unsafe" 
              : `Place ${isLong ? "Long" : "Short"} Order`
            }
          </button>
        </div>
      </div>

      {/* POSITIONS SECTION */}
      <div className="positions-section mt-8 md:mt-12">
        <div className="flex items-center justify-between gap-4 mb-4 sm:mb-6 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight">Your Positions</h2>
          {optimisticPositions.length > 0 && (
            <span className="text-xs px-2.5 py-1 rounded bg-[var(--green)]/10 text-[var(--green)] font-mono border border-[var(--green)]/20">
              {optimisticPositions.length} active order{optimisticPositions.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {accountAddress ? (
          <PositionList account={accountAddress} optimisticPositions={optimisticPositions} />
        ) : (
          <div className="p-6 sm:p-8 text-center text-[var(--muted)] border border-[var(--line)] rounded-xl bg-white/5 text-sm sm:text-base">
            Please connect your wallet to view your positions.
          </div>
        )}
      </div>

      <style>{`
        .trade-page {
          padding: 8px 12px 36px;
          max-width: 1400px;
          margin: 0 auto;
        }
        @media (min-width: 640px) {
          .trade-page {
            padding: 12px 16px 48px;
          }
        }
        .trade-header {
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--line);
        }
        @media (min-width: 640px) {
          .trade-header {
            margin-bottom: 16px;
            padding-bottom: 12px;
          }
        }
        .market-info {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .market-info h1 {
          font-size: clamp(20px, 4vw, 24px);
          margin: 0;
        }
        .price-display {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .price-display .price {
          font-size: clamp(18px, 4vw, 24px);
          font-weight: 700;
        }
        .trade-content {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
          align-items: stretch;
        }
        @media (min-width: 1024px) {
          .trade-content {
            grid-template-columns: 1fr 360px;
            gap: 24px;
            align-items: stretch;
          }
        }
        .chart-area {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-width: 0;
        }
        .chart-wrapper {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--line);
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          flex: 1;
          height: 100%;
          position: relative;
          outline: none;
        }
        .chart-wrapper div,
        .chart-wrapper canvas {
          outline: none !important;
        }
        .chart-placeholder {
          height: 100%;
          min-height: 300px;
          background: transparent;
          border: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--muted);
          font-weight: 500;
          font-size: 14px;
          flex: 1;
        }
        @media (min-width: 640px) {
          .chart-placeholder {
            min-height: 360px;
          }
        }
        @media (min-width: 1024px) {
          .chart-placeholder {
            min-height: 480px;
          }
        }
        .order-panel {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          min-width: 0;
        }
        @media (min-width: 640px) {
          .order-panel {
            padding: 20px;
            gap: 24px;
          }
        }
        .order-tabs {
          display: flex;
          gap: 8px;
          background: rgba(0, 0, 0, 0.2);
          padding: 4px;
          border-radius: 8px;
        }
        .order-tabs .tab {
          flex: 1;
          min-height: 42px;
          padding: 10px;
          border: none;
          background: transparent;
          color: var(--muted);
          font-weight: 600;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .order-tabs .tab:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .order-tabs .tab.active {
          color: var(--fg);
          background: rgba(255, 255, 255, 0.1);
        }
        .order-tabs .tab.active.long { background: rgba(194, 255, 71, 0.15); color: var(--green); }
        .order-tabs .tab.active.short { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
        
        .input-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 13px;
          color: var(--muted);
        }
        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .input-wrapper input {
          width: 100%;
          min-height: 46px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px 16px;
          padding-right: 60px;
          color: var(--fg);
          font-size: 16px;
          outline: none;
        }
        .input-wrapper input:focus { border-color: var(--green); }
        .input-wrapper .currency {
          position: absolute;
          right: 16px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 600;
        }
        .leverage-slider {
          width: 100%;
          accent-color: var(--green);
          height: 6px;
          cursor: pointer;
        }
        .order-summary {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .summary-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: var(--muted);
        }
        .summary-row span:last-child {
          color: var(--fg);
          font-weight: 500;
        }
        .submit-btn {
          width: 100%;
          min-height: 48px;
          padding: 14px;
          border: none;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        @media (min-width: 640px) {
          .submit-btn {
            font-size: 16px;
            padding: 16px;
          }
        }
        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: var(--line) !important;
          color: var(--muted) !important;
        }
        .submit-btn.long {
          background: var(--green);
          color: black;
        }
        .submit-btn.short {
          background: #ff6b6b;
          color: white;
        }
        .mt-4 { margin-top: 24px; }
        .mt-2 { margin-top: 8px; }
        .text-sm { font-size: 14px; }
      `}</style>
    </div>
  );
}
