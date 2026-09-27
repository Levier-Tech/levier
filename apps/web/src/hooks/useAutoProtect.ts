"use client";

import { env } from "../env.mjs";
import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { AutoProtectModuleABI } from "../contracts/abis";
import { getAddresses } from "../contracts/addresses";
import { saveAutoProtectConfig } from "../lib/api";
import { NetworkMode } from "@levera/types";

export function useAutoProtect(networkMode: NetworkMode) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isSaving, setIsSaving] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getAddresses(networkMode);

  const saveRule = useCallback(
    async (
      pairSymbol: string,
      triggerLtvPercent: number,
      targetLtvPercent: number,
      maxDeleverageUsd: number,
    ) => {
      if (!env.TRADING_ENABLED)
        throw new Error("Execution is awaiting deployment verification");
      if (!publicClient) throw new Error("RPC client unavailable");
      if (!address) throw new Error("Wallet not connected");
      setIsSaving(true);
      setTxHash(null);

      try {
        const pairAddress = addresses.pairs[pairSymbol] || addresses.pairs.NVDA;
        const triggerBps = BigInt(Math.round(triggerLtvPercent * 100));
        const targetBps = BigInt(Math.round(targetLtvPercent * 100));
        const maxDeleverageUnits = parseUnits(maxDeleverageUsd.toString(), 18);

        // 1. Write rule on-chain to AutoProtectModule
        const hash = await writeContractAsync({
          address: addresses.autoProtect,
          abi: AutoProtectModuleABI,
          functionName: "setProtectionRule",
          args: [pairAddress, triggerBps, targetBps, maxDeleverageUnits],
        });

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          if (receipt.status !== "success")
            throw new Error("Transaction reverted");
        }

        // 2. Sync to Backend API Gateway
        try {
          await saveAutoProtectConfig({
            userAddress: address.toLowerCase(),
            network: networkMode,
            triggerLtv: triggerLtvPercent,
            targetLtv: targetLtvPercent,
            maxDeleverage: maxDeleverageUsd,
            isEnabled: true,
          });
        } catch (syncErr) {
          console.warn("Could not sync rule via Levera API:", syncErr);
        }

        setTxHash(hash);
        setIsSaving(false);
        return hash;
      } catch (err) {
        setIsSaving(false);
        console.error("Save auto protect rule failed:", err);
        throw err;
      }
    },
    [address, addresses, networkMode, publicClient, writeContractAsync],
  );

  return {
    saveRule,
    isSaving,
    txHash,
  };
}
