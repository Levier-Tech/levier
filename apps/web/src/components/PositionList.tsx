"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ponsClient } from "@/lib/pons-client";
import type { PositionData } from "@/lib/pons-client";

export function PositionList({ account, optimisticPositions = [] }: { account: string, optimisticPositions?: PositionData[] }) {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPos, setClosingPos] = useState<PositionData | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      try {
        const data = await ponsClient.getPositions(account);
        setPositions(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
    // Simulate real-time updates
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [account]);

  const allPositions = [...optimisticPositions, ...positions];
  const activePositions = allPositions.filter(p => !closedIds.has(p.id));

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-[var(--muted)]">Loading positions...</div>;
  }

  if (activePositions.length === 0) {
    return (
      <div className="positions-empty">
        <p>No active positions found.</p>
        <span className="text-sm mt-2 block">Open a new position to see it here.</span>
      </div>
    );
  }

  const renderModals = () => {
    if (!mounted) return null;
    
    return createPortal(
      <>
        {closingPos && (
          <div className="modal-overlay">
            <div className="modal-content">
              <h3>Close {closingPos.asset} Position</h3>
              <p>Are you sure you want to close your <strong>{closingPos.isLong ? 'Long' : 'Short'}</strong> position for {closingPos.asset}? This action is permanent.</p>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={() => setClosingPos(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => {
                  const fakeHash = "0x" + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');
                  setClosedIds(prev => new Set(prev).add(closingPos.id));
                  setClosingPos(null);
                  setSuccessTx(fakeHash);
                }}>Confirm Close</button>
              </div>
            </div>
          </div>
        )}

        {successTx && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>✅</div>
              <h3>Position Closed!</h3>
              <p>Your position has been successfully closed on-chain.</p>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px", fontFamily: "var(--font-space)", color: "var(--green)", marginBottom: "24px", wordBreak: "break-all", fontSize: "14px" }}>
                Tx: {successTx}
              </div>
              <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setSuccessTx(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </>,
      document.body
    );
  };

  return (
    <div className="positions-container">
      <div className="positions-grid">
      {activePositions.map((pos) => {
        const isProfit = pos.pnlUsd >= 0;
        const pnlClass = isProfit ? "profit" : "loss";
        
        // Simple mock health factor: based on distance to liquidation
        // Equity = Collateral + PnL
        const equity = pos.collateralUsd + pos.pnlUsd;
        // Maintenance Margin = 5% of Size
        const mm = pos.sizeUsd * 0.05;
        const healthFactor = mm > 0 ? equity / mm : 10;
        
        let healthColor = "var(--green)";
        if (healthFactor < 1.5) healthColor = "#ffb84d";
        if (healthFactor < 1.1) healthColor = "#d6153c";

        return (
          <div className="position-card" key={pos.id}>
            <div className="card-header">
              <div className="flex items-center gap-3">
                <div className="asset-icon">
                  <img src={`/assets/pons/${pos.asset.toLowerCase()}.svg`} alt={pos.asset} onError={(e) => { e.currentTarget.src = "/assets/Logo.png"; }} />
                </div>
                <div>
                  <h4 className="font-display text-lg font-bold tracking-tight">{pos.asset}/USD</h4>
                  <span className={`side-badge ${pos.isLong ? "long" : "short"}`}>
                    {pos.isLong ? "LONG" : "SHORT"} {pos.leverage.toFixed(1)}x
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className={`pnl-display ${pnlClass}`}>
                  {isProfit ? "+" : ""}${pos.pnlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
                <div className={`pnl-pct ${pnlClass}`}>
                  {isProfit ? "+" : ""}{pos.pnlPercentage.toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="card-metrics">
              <div className="metric">
                <span className="label">Position Size</span>
                <span className="value">${pos.sizeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="metric">
                <span className="label">Collateral</span>
                <span className="value">${pos.collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="metric">
                <span className="label">Entry Price</span>
                <span className="value">${pos.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              </div>
              <div className="metric">
                <span className="label">Mark Price</span>
                <span className="value">${pos.markPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              </div>
              <div className="metric">
                <span className="label">Liq. Price</span>
                <span className="value text-[#d6153c]">${pos.liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              </div>
              <div className="metric">
                <span className="label">Health Factor</span>
                <span className="value font-display" style={{ color: healthColor }}>
                  {healthFactor.toFixed(2)}x
                </span>
              </div>
            </div>

            <div className="card-actions">
              <button className="btn-secondary" onClick={() => alert(`Adding collateral to ${pos.asset}...`)}>
                Add Collateral
              </button>
              <button className="btn-primary" onClick={() => setClosingPos(pos)}>
                Close Position
              </button>
            </div>
          </div>
        );
      })}
      </div>

      {renderModals()}

      <style>{`
        .positions-empty {
          padding: 40px 24px;
          text-align: center;
          color: var(--muted);
          background: rgba(255, 255, 255, 0.02);
          border: 1px dashed var(--line);
          border-radius: 12px;
        }
        .positions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
          gap: 16px;
        }
        .position-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-width: 0;
          transition: border-color 0.2s, transform 0.2s;
        }
        .position-card:hover {
          border-color: #34372e;
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.03);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 10px;
        }
        .asset-icon {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--line);
          shrink: 0;
        }
        .asset-icon img {
          width: 22px;
          height: 22px;
          object-fit: contain;
        }
        .side-badge {
          display: inline-block;
          margin-top: 4px;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .side-badge.long {
          background: rgba(194, 255, 71, 0.15);
          color: var(--green);
        }
        .side-badge.short {
          background: rgba(255, 107, 107, 0.15);
          color: #d6153c;
        }
        .pnl-display {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .pnl-pct {
          font-size: 12px;
          font-weight: 600;
        }
        .profit { color: var(--green); }
        .loss { color: #d6153c; }
        
        .card-metrics {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px 14px;
          padding: 14px 0;
          border-top: 1px solid var(--line);
          border-bottom: 1px solid var(--line);
          min-width: 0;
        }
        .metric {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .metric .label {
          font-size: 11px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .metric .value {
          font-size: 13px;
          color: var(--text);
          font-weight: 500;
          word-break: break-all;
        }
        
        .card-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .btn-primary, .btn-secondary {
          flex: 1 1 120px;
          min-height: 40px;
          padding: 10px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-primary {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }
        .btn-primary:hover {
          background: rgba(255, 107, 107, 0.8);
        }
        .btn-secondary {
          background: transparent;
          border-color: var(--line);
          color: var(--muted);
        }
        .btn-secondary:hover {
          border-color: var(--green);
          color: var(--green);
        }

        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
          padding: 16px;
        }
        .modal-content {
          background: #0f100c;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 24px;
          width: 100%;
          max-width: 420px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        }
        .modal-content h3 {
          margin-top: 0;
          margin-bottom: 12px;
          font-family: var(--font-space);
          font-size: 19px;
          color: white;
        }
        .modal-content p {
          color: var(--muted);
          margin-bottom: 24px;
          line-height: 1.5;
          font-size: 14px;
        }
        .modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
      `}</style>
    </div>
  );
}
