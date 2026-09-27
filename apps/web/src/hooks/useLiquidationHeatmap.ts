'use client';

import { useState, useEffect, useCallback } from 'react';
import { NetworkMode, LiquidationHeatmapData, ProtocolRiskStats } from '@levera/types';
import { fetchLiquidationHeatmap, fetchProtocolRiskStats } from '../lib/api';
import { useSmartPolling } from './useSmartPolling';

export function useLiquidationHeatmap(assetSymbol: string, networkMode: NetworkMode) {
  const [heatmapData, setHeatmapData] = useState<LiquidationHeatmapData | null>(null);
  const [stats, setStats] = useState<ProtocolRiskStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadLiquidationData = useCallback(async () => {
    try {
      setError(null);
      const [hmData, protocolStats] = await Promise.all([
        fetchLiquidationHeatmap(assetSymbol, networkMode),
        fetchProtocolRiskStats(networkMode),
      ]);

      setHeatmapData(hmData);
      setStats(protocolStats);
    } catch (err: any) {
      console.error('Error fetching liquidation heatmap data from API:', err);
      setError(err.message || 'Failed to load liquidation heatmap');
    } finally {
      setIsLoading(false);
    }
  }, [assetSymbol, networkMode]);

  useEffect(() => {
    setIsLoading(true);
    loadLiquidationData();
  }, [loadLiquidationData]);

  // Smart polling every 15s (automatically paused when browser tab is inactive)
  useSmartPolling(loadLiquidationData, 15000);

  return {
    heatmapData,
    stats,
    isLoading,
    error,
    refetch: loadLiquidationData,
  };
}

