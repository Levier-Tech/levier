import { parseMarketRows } from "./market-data.mjs";
import {
  MarketConfig,
  VaultConfig,
  Position,
  AutoProtectConfig,
  LiquidationHeatmapData,
  ProtocolRiskStats,
  NetworkMode,
  PositionType,
} from "@levier/types";

const API_BASE = "/api/v1";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Market service unavailable (${res.status}). Please try again.`,
    );
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// 1. Markets API
// ---------------------------------------------------------------------------
export async function fetchMarkets(
  network: NetworkMode = "TESTNET",
  category?: string,
): Promise<MarketConfig[]> {
  const params = new URLSearchParams({ network });
  if (category && category !== "All") {
    params.append("category", category);
  }

  const result = await fetchJson<{ success: boolean; data: any[] }>(
    `${API_BASE}/markets?${params.toString()}`,
  );

  return parseMarketRows(result.data, network) as MarketConfig[];
}

export async function fetchMarketBySlug(
  slug: string,
  network: NetworkMode,
): Promise<MarketConfig> {
  const result = await fetchJson<{ success: boolean; data: unknown }>(
    `${API_BASE}/markets/${encodeURIComponent(slug)}?network=${network}`,
  );
  return parseMarketRows([result.data], network)[0] as MarketConfig;
}

// ---------------------------------------------------------------------------
// 2. Vaults API
// ---------------------------------------------------------------------------
export async function fetchVaults(
  network: NetworkMode = "TESTNET",
): Promise<VaultConfig[]> {
  const result = await fetchJson<{ success: boolean; data: any[] }>(
    `${API_BASE}/vaults?network=${network}`,
  );

  return (result.data || []).map((row: any) => ({
    id: row.id,
    slug: row.slug || row.vault_slug || "usdg-prime",
    name: row.name,
    symbol:
      row.symbol || (row.asset_symbol ? `lv${row.asset_symbol}` : "lvUSDG"),
    network: row.network,
    assetSymbol: row.asset_symbol || "USDG",
    apy: Number(row.apy || 0),
    tvlUsd: Number(row.tvl_usd || 0),
    utilizationRate: Number(row.utilization_rate || 0),
    riskTier: row.risk_tier || "Balanced",
    allocations:
      Array.isArray(row.allocations) && row.allocations.length > 0
        ? row.allocations
        : [],
    description: row.description,
  }));
}

// ---------------------------------------------------------------------------
// 3. Positions API
// ---------------------------------------------------------------------------
export interface CreatePositionPayload {
  id?: string;
  network: NetworkMode;
  userAddress: string;
  marketId?: string;
  assetSymbol: string;
  pairAddress: string;
  positionType: PositionType;
  leverage: number;
  equityUsd: number;
  exposureUsd: number;
  collateralAmount: number;
  debtAmount: number;
  entryPrice: number;
  markPrice?: number;
  liquidationPrice?: number;
  healthFactor?: number;
  txHash?: string;
}

export async function fetchPositions(
  address: string,
  network: NetworkMode = "TESTNET",
  status?: string,
): Promise<Position[]> {
  const params = new URLSearchParams({ network });
  if (status) {
    params.append("status", status);
  }

  const result = await fetchJson<{ success: boolean; data: any[] }>(
    `${API_BASE}/positions/${address.toLowerCase()}?${params.toString()}`,
  );

  return (result.data || []).map((p: any) => ({
    id: p.id,
    assetSymbol: p.asset_symbol,
    positionType: p.position_type as PositionType,
    network: p.network,
    leverage: Number(p.leverage),
    equityUsd: Number(p.equity_usd),
    exposureUsd: Number(p.exposure_usd),
    entryPrice: Number(p.entry_price),
    markPrice: Number(p.mark_price || p.entry_price),
    liquidationPrice: Number(p.liquidation_price || 0),
    healthFactor: Number(p.health_factor || 2.0),
    pnlUsd: Number(p.pnl_usd || 0),
    pnlPercent: Number(p.pnl_percent || 0),
  }));
}

export async function createPosition(
  payload: CreatePositionPayload,
): Promise<any> {
  return fetchJson<{ success: boolean; data: any }>(`${API_BASE}/positions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function closePosition(
  id: string,
  params?: { userAddress?: string; txHash?: string; network?: NetworkMode },
): Promise<any> {
  return fetchJson<{ success: boolean; message: string; data?: any }>(
    `${API_BASE}/positions/${id}/close`,
    {
      method: "PATCH",
      body: JSON.stringify(params || {}),
    },
  );
}

// ---------------------------------------------------------------------------
// 4. Auto-Protect API
// ---------------------------------------------------------------------------
export interface SaveAutoProtectPayload {
  network: NetworkMode;
  userAddress: string;
  positionId?: string;
  isEnabled: boolean;
  triggerLtv: number;
  targetLtv: number;
  maxDeleverage: number;
}

export async function fetchAutoProtectConfig(
  address: string,
  network: NetworkMode = "TESTNET",
): Promise<AutoProtectConfig | null> {
  const result = await fetchJson<{ success: boolean; data: any[] }>(
    `${API_BASE}/auto-protect/${address.toLowerCase()}?network=${network}`,
  );

  const configs = result.data || [];
  if (configs.length === 0) return null;

  const rule = configs[0];
  return {
    isEnabled: Boolean(rule.is_enabled),
    triggerLtvPercent: Number(rule.trigger_ltv),
    targetLtvPercent: Number(rule.target_ltv),
    maxDeleverageUsd: Number(rule.max_deleverage),
  };
}

export async function saveAutoProtectConfig(
  payload: SaveAutoProtectPayload,
): Promise<any> {
  return fetchJson<{ success: boolean; message: string }>(
    `${API_BASE}/auto-protect`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

// ---------------------------------------------------------------------------
// 5. Liquidations API
// ---------------------------------------------------------------------------
export async function fetchLiquidationHeatmap(
  asset: string,
  network: NetworkMode = "TESTNET",
): Promise<LiquidationHeatmapData> {
  const result = await fetchJson<{
    success: boolean;
    data: LiquidationHeatmapData;
  }>(
    `${API_BASE}/liquidations/heatmap?asset=${encodeURIComponent(asset)}&network=${network}`,
  );
  return result.data;
}

export async function fetchProtocolRiskStats(
  network: NetworkMode = "TESTNET",
): Promise<ProtocolRiskStats> {
  const result = await fetchJson<{ success: boolean; data: ProtocolRiskStats }>(
    `${API_BASE}/liquidations/stats?network=${network}`,
  );
  return result.data;
}
