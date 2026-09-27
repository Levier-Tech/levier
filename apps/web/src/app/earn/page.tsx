"use client";

import { AppPage, DataState } from "../../components/AppPage";
import React from "react";
import { useNetworkMode } from "../../hooks/useNetworkMode";
import { useLevierVault } from "../../hooks/useLevierVault";
import { VaultCard, VaultCardSkeleton } from "../../components/VaultCard";

export default function EarnPage() {
  const { networkMode } = useNetworkMode();
  const { vaults, isLoading, error, refetch } = useLevierVault(networkMode);

  return (
    <AppPage
      eyebrow="Earn"
      title="Put your assets to work."
      description="Explore lending vaults and review their allocation, utilization, and withdrawal conditions."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {error ? (
          <DataState title="Vault data unavailable" retry={refetch}>
            Vault data could not be loaded. Please retry before reviewing a
            vault.
          </DataState>
        ) : isLoading ? (
          /* Shimmer Skeleton Cards */
          <>
            <VaultCardSkeleton />
            <VaultCardSkeleton />
          </>
        ) : vaults.length === 0 ? (
          /* Empty State */
          <div className="col-span-full py-16 px-8 bg-surface border border-dashed border-white/10 rounded-sm text-center font-sans space-y-3">
            <span className="text-white font-bold block text-sm uppercase tracking-wider">
              [NO YIELD VAULTS ACTIVE]
            </span>
            <p className="text-xs text-muted-dark max-w-md mx-auto">
              There are currently no active ERC-4626 liquidity strategy vaults.
            </p>
          </div>
        ) : (
          /* Live Vault Cards */
          vaults.map((vault) => <VaultCard key={vault.id} vault={vault} />)
        )}
      </div>
    </AppPage>
  );
}
