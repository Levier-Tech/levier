'use client';

import { useState, useEffect, useCallback } from 'react';
import { VaultConfig, NetworkMode } from '@levier/types';
import { fetchVaults as apiFetchVaults } from '../lib/api';
import { useSmartPolling } from './useSmartPolling';

export function useLevierVault(networkMode: NetworkMode) {
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadVaults = useCallback(async () => {
    try {
      const data = await apiFetchVaults(networkMode);
      setVaults(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch vaults from Levier API:', err);
      setError(err.message || 'Error fetching vaults');
    } finally {
      setIsLoading(false);
    }
  }, [networkMode]);

  useEffect(() => {
    loadVaults();
  }, [loadVaults]);

  // Smart polling every 30s (automatically paused when browser tab is inactive)
  useSmartPolling(loadVaults, 30000);

  const primaryVault = vaults[0];

  return {
    vaults,
    primaryVault,
    isLoading,
    error,
    refetch: loadVaults,
  };
}

