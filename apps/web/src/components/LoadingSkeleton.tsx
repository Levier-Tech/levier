import type { ReactNode } from "react";
import { assetCatalog } from "../lib/asset-catalog";

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`app-skeleton ${className}`} />;
}

function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-label={label} className="loading-region">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="skeleton-content">
        {children}
      </div>
    </div>
  );
}

function MetricBlocks({ count }: { count: number }) {
  return (
    <div className="market-metrics">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-stack">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-36" />
        </div>
      ))}
    </div>
  );
}

export function MetricsSkeleton({
  count = 6,
  label = "Loading market data",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <MetricBlocks count={count} />
    </LoadingRegion>
  );
}

function PositionCard({ metrics = 6 }: { metrics?: number }) {
  return (
    <div className="app-panel market-overview">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-8 w-56" />
      <MetricBlocks count={metrics} />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function PositionSkeleton() {
  return (
    <LoadingRegion label="Loading your portfolio">
      <PositionCard metrics={8} />
    </LoadingRegion>
  );
}

export function WorkspaceSkeleton({
  label = "Loading your position and market",
}: {
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="market-detail-layout">
        <PositionCard />
        <div className="app-panel market-action">
          <Skeleton className="h-8 w-52" />
          {[0, 1, 2].map((index) => (
            <div className="skeleton-stack" key={index}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-12 w-full skeleton-accent" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    </LoadingRegion>
  );
}

export function AnalyticsSkeleton() {
  return (
    <LoadingRegion label="Loading confirmed analytics">
      <div className="analytics-summary">
        {[0, 1, 2, 3].map((index) => (
          <div className="app-panel" key={index}>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-9 w-28 skeleton-accent" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
      <div className="analytics-market-grid">
        <PositionCard metrics={8} />
        <PositionCard metrics={8} />
      </div>
    </LoadingRegion>
  );
}

export function HistorySkeleton() {
  return (
    <LoadingRegion label="Loading verified transaction history">
      {[0, 1, 2].map((row) => (
        <div key={row} className="skeleton-history-row">
          {[0, 1, 2, 3, 4, 5].map((column) => (
            <Skeleton key={column} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </LoadingRegion>
  );
}

type PageLayout =
  "analytics" | "portfolio" | "markets" | "lending" | "trade" | "market";
export function PageLoadingSkeleton({ layout }: { layout: PageLayout }) {
  return (
    <div className="app-page">
      <div className="app-page-heading skeleton-stack" aria-hidden="true">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="app-page-content">
        {layout === "analytics" ? (
          <AnalyticsSkeleton />
        ) : layout === "portfolio" ? (
          <PositionSkeleton />
        ) : layout === "markets" ? (
          <LoadingRegion label="Loading market directory">
            <div className="asset-directory">
              {assetCatalog.map((asset) => (
                <div className="directory-card" key={asset.ticker}>
                  <Skeleton className="h-12 w-12 shrink-0" />
                  <div className="skeleton-stack flex-1 min-w-0">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-3 w-36" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </LoadingRegion>
        ) : (
          <WorkspaceSkeleton
            label={`Loading ${layout === "market" ? "market details" : `${layout} workspace`}`}
          />
        )}
      </div>
    </div>
  );
}
