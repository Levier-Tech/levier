"use client";

import { env } from "../env.mjs";
import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits } from "viem";
import { LeveraVaultABI, TestnetERC20ABI } from "../contracts/abis";
import { getAddresses } from "../contracts/addresses";
import { NetworkMode } from "@levera/types";

export function useVaultDeposit(networkMode: NetworkMode) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isProcessing, setIsProcessing] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getAddresses(networkMode);

  const depositLiquidity = useCallback(
    async (amountUsdg: number) => {
      if (!env.TRADING_ENABLED)
        throw new Error("Execution is awaiting deployment verification");
      if (!publicClient) throw new Error("RPC client unavailable");
      if (!address) throw new Error("Wallet not connected");
      setIsProcessing(true);
      setTxHash(null);

      try {
        const units = parseUnits(amountUsdg.toString(), 18);

        // 1. Approve USDG to Vault
        const approveHash = await writeContractAsync({
          address: addresses.usdg,
          abi: TestnetERC20ABI,
          functionName: "approve",
          args: [addresses.leveraVault, units],
        });

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: approveHash,
          });
          if (receipt.status !== "success")
            throw new Error("Transaction reverted");
        }

        // 2. Deposit into LeveraVault
        const depositHash = await writeContractAsync({
          address: addresses.leveraVault,
          abi: LeveraVaultABI,
          functionName: "deposit",
          args: [units, address],
        });

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: depositHash,
          });
          if (receipt.status !== "success")
            throw new Error("Transaction reverted");
        }

        setTxHash(depositHash);
        setIsProcessing(false);
        return depositHash;
      } catch (err) {
        setIsProcessing(false);
        console.error("Vault deposit failed:", err);
        throw err;
      }
    },
    [address, addresses, publicClient, writeContractAsync],
  );

  return {
    depositLiquidity,
    isProcessing,
    txHash,
  };
}
