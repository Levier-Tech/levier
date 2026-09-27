"use client";
import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { env } from "../env.mjs";
import {
  readLendingSnapshot,
  type LendingDeployment,
} from "../lib/lending-client";
export function useVerifiedLending(
  selected: LendingDeployment | null = env.LENDING_DEPLOYMENT_JSON as LendingDeployment | null,
) {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const deployment = selected;
  const snapshot = useQuery({
    queryKey: ["verified-lending", deployment, address, chainId],
    queryFn: () => {
      if (!client || !deployment || !address)
        throw Error("Wallet and verified market required");
      return readLendingSnapshot(client, deployment, address);
    },
    enabled: !!client && !!deployment && !!address && chainId === env.CHAIN_ID,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
  return { address, chainId, client, deployment, snapshot };
}
