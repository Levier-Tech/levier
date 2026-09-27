'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Position, PortfolioSummary, NetworkMode, AutoProtectConfig } from '@levera/types';
import { useAccount } from 'wagmi';
import {
  fetchPositions,
  fetchAutoProtectConfig,
  closePosition as apiClosePosition,
  saveAutoProtectConfig,
} from '../lib/api';
import { useSmartPolling } from './useSmartPolling';

const DEFAULT_AUTO_PROTECT: AutoProtectConfig = {
  isEnabled: true,
  triggerLtvPercent: 75,
  targetLtvPercent: 55,
  maxDeleverageUsd: 1000,
};

export function useLeveraPortfolio(networkMode: NetworkMode) {
  const { address } = useAccount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [autoProtect, setAutoProtect] = useState<AutoProtectConfig>(DEFAULT_AUTO_PROTECT);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchPortfolio = useCallback(async () => {
    if (!address) {
      setPositions([]);
      return;
    }

    try {
      setIsLoading(true);

      // Fetch positions for the connected wallet & network via Backend API Gateway
      const userPositions = await fetchPositions(address, networkMode, 'ACTIVE,OPEN');
      setPositions(userPositions);

      // Fetch Auto-Protect configuration via Backend API Gateway
      const apConfig = await fetchAutoProtectConfig(address, networkMode);
      if (apConfig) {
        setAutoProtect(apConfig);
      }
    } catch (err) {
      console.error('Failed to load portfolio from API:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address, networkMode]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  // Smart polling every 10s (automatically paused when browser tab is inactive)
  useSmartPolling(fetchPortfolio, 10000, Boolean(address));

  const summary: PortfolioSummary = useMemo(() => {
    const totalEquity = positions.reduce((acc, p) => acc + p.equityUsd, 0);
    const totalDebt = positions.reduce((acc, p) => acc + Math.max(0, p.exposureUsd - p.equityUsd), 0);
    const totalCollateral = totalEquity + totalDebt;
    const netEquity = totalEquity;
    const borrowingPower = Math.max(0, netEquity * 0.75 - totalDebt);
    const weightedLtv = totalCollateral > 0 ? (totalDebt / totalCollateral) * 100 : 0;
    const healthFactor = totalDebt > 0 ? (totalCollateral * 0.8) / totalDebt : 3.0;
    const pnl24h = positions.reduce((acc, p) => acc + p.pnlUsd, 0);

    return {
      portfolioValueUsd: totalCollateral,
      collateralUsd: totalCollateral,
      debtUsd: totalDebt,
      netEquityUsd: netEquity,
      borrowingPowerUsd: borrowingPower,
      weightedLtvPercent: weightedLtv,
      healthFactor: parseFloat(healthFactor.toFixed(2)),
      pnl24hUsd: pnl24h,
    };
  }, [positions]);

  const closePosition = async (id: string) => {
    try {
      await apiClosePosition(id, {
        userAddress: address?.toLowerCase(),
        network: networkMode,
      });
      fetchPortfolio();
    } catch (err) {
      console.error('Failed to close position via API:', err);
    }
  };

  const updateAutoProtect = async (config: AutoProtectConfig) => {
    setAutoProtect(config);
    if (address) {
      try {
        await saveAutoProtectConfig({
          network: networkMode,
          userAddress: address.toLowerCase(),
          triggerLtv: config.triggerLtvPercent,
          targetLtv: config.targetLtvPercent,
          maxDeleverage: config.maxDeleverageUsd,
          isEnabled: config.isEnabled,
        });
      } catch (err) {
        console.error('Failed to update auto protect via API:', err);
      }
    }
  };

  return {
    positions,
    summary,
    autoProtect,
    isLoading,
    refetch: fetchPortfolio,
    closePosition,
    updateAutoProtect,
  };
}

