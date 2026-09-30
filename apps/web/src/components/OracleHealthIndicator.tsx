import React from "react";
import type { OracleStatus } from "@/lib/pons-client";

interface OracleHealthIndicatorProps {
  status?: OracleStatus | null;
  loading?: boolean;
}

export function OracleHealthIndicator({ status, loading }: OracleHealthIndicatorProps) {
  if (loading) {
    return (
      <div className="oracle-indicator app-skeleton" style={{ width: 120, height: 24, borderRadius: 12 }} />
    );
  }

  if (!status) {
    return (
      <div className="oracle-indicator unknown">
        <span className="dot" />
        <span>Oracle: Unknown</span>
      </div>
    );
  }

  const { isSafe, deviationBps } = status;
  const deviationPct = (deviationBps / 100).toFixed(2);
  
  // Choose class based on status
  let className = "oracle-indicator";
  if (status.status === "HEALTHY") className += " healthy";
  if (status.status === "WARNING") className += " warning";
  if (status.status === "CRITICAL") className += " critical";

  return (
    <div className={className} title={`TWAP Deviation: ${deviationPct}%`}>
      <span className="dot" />
      <span>
        {status.status === "HEALTHY" && "Oracle: Healthy"}
        {status.status === "WARNING" && "Oracle: High Volatility"}
        {status.status === "CRITICAL" && "Oracle: Unsafe Deviation"}
      </span>
      {!isSafe && <span className="deviation-warn">({deviationPct}%)</span>}
      
      <style>{`
        .oracle-indicator {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--line);
          color: var(--muted);
        }
        .oracle-indicator .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
        .oracle-indicator.healthy {
          color: var(--green);
          background: rgba(194, 255, 71, 0.1);
          border-color: rgba(194, 255, 71, 0.2);
        }
        .oracle-indicator.warning {
          color: #f5a623;
          background: rgba(245, 166, 35, 0.1);
          border-color: rgba(245, 166, 35, 0.2);
        }
        .oracle-indicator.critical {
          color: #d6153c;
          background: rgba(255, 107, 107, 0.1);
          border-color: rgba(255, 107, 107, 0.2);
        }
        .deviation-warn {
          margin-left: 4px;
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}
