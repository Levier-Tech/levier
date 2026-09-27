"use client";

import { env } from "../env.mjs";
import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits, Address } from "viem";
import {
  LeverageRouterABI,
  ShortRouterABI,
  TestnetERC20ABI,
} from "../contracts/abis";
import { getAddresses } from "../contracts/addresses";
import { createPosition } from "../lib/api";
import { NetworkMode, PositionType } from "@levera/types";

export type TradeStep =
  "IDLE" | "APPROVING" | "EXECUTING" | "CONFIRMING" | "SUCCESS" | "ERROR";

export interface ExecuteTradeParams {
  symbol: string;
  positionType: PositionType;
  collateralAmount: number; // e.g. 1000 USDG
  leverage: number; // e.g. 2.0
  markPrice: number; // e.g. 250
}

export function useLeverageTrade(networkMode: NetworkMode) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<TradeStep>("IDLE");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const addresses = getAddresses(networkMode);

  const executeTrade = useCallback(
    async ({
      symbol,
      positionType,
      collateralAmount,
      leverage,
      markPrice,
    }: ExecuteTradeParams) => {
      if (!env.TRADING_ENABLED)
        throw new Error("Execution is awaiting deployment verification");
      if (!publicClient) throw new Error("RPC client unavailable");
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your Web3 wallet first.",
        );
      }

      setStep("IDLE");
      setErrorMessage(null);
      setTxHash(null);

      try {
        const pairAddress = addresses.pairs[symbol];
        if (!pairAddress) {
          throw new Error(
            `Trading pair for ${symbol} is not deployed on the configured network`,
          );
        }

        const collateralInUnits = parseUnits(collateralAmount.toString(), 18);
        const totalExposure = collateralAmount * leverage;
        const borrowedAmount = Math.max(0, totalExposure - collateralAmount);
        const borrowedUnits = parseUnits(borrowedAmount.toFixed(6), 18);

        // Target Router
        const targetRouter =
          positionType === "SHORT"
            ? addresses.shortRouter
            : addresses.leverageRouter;

        // Step 1: Approve Collateral (USDG) to Router
        setStep("APPROVING");
        const approveHash = await writeContractAsync({
          address: addresses.usdg,
          abi: TestnetERC20ABI,
          functionName: "approve",
          args: [targetRouter, collateralInUnits], // approve sufficient margin
        });

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: approveHash,
          });
          if (receipt.status !== "success")
            throw new Error("Transaction reverted");
        }

        // Step 2: Execute Router Order
        setStep("EXECUTING");
        let orderHash: `0x${string}`;

        if (positionType === "SHORT") {
          // Calculate stock tokens to borrow: borrowedAmount / markPrice
          const stockToBorrow = borrowedAmount / markPrice;
          const stockUnits = parseUnits(stockToBorrow.toFixed(6), 18);
          const minStableReceived = (borrowedUnits * 95n) / 100n; // 5% max slippage

          orderHash = await writeContractAsync({
            address: addresses.shortRouter,
            abi: ShortRouterABI,
            functionName: "openShort",
            args: [
              pairAddress,
              collateralInUnits,
              stockUnits,
              minStableReceived,
            ],
          });
        } else {
          // LONG or MULTIPLY
          const stockToAcquire = totalExposure / markPrice;
          const minStockReceived =
            (parseUnits(stockToAcquire.toFixed(6), 18) * 95n) / 100n;

          orderHash = await writeContractAsync({
            address: addresses.leverageRouter,
            abi: LeverageRouterABI,
            functionName: "leverageBuy",
            args: [
              pairAddress,
              collateralInUnits,
              borrowedUnits,
              minStockReceived,
            ],
          });
        }

        setTxHash(orderHash);
        setStep("CONFIRMING");

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: orderHash,
          });
          if (receipt.status !== "success")
            throw new Error("Transaction reverted");
        }

        // Step 3: Record position via Backend API Gateway
        try {
          await createPosition({
            network: networkMode,
            userAddress: address.toLowerCase(),
            assetSymbol: symbol,
            pairAddress,
            positionType,
            leverage,
            equityUsd: collateralAmount,
            exposureUsd: totalExposure,
            collateralAmount,
            debtAmount: borrowedAmount,
            entryPrice: markPrice,
            txHash: orderHash,
          });
        } catch (syncErr) {
          console.warn("Could not sync position via Levera API:", syncErr);
        }

        setStep("SUCCESS");
        return orderHash;
      } catch (err: any) {
        setStep("ERROR");
        setErrorMessage(
          "Transaction could not be completed. Check your wallet and transaction status.",
        );
        throw err;
      }
    },
    [address, addresses, networkMode, publicClient, writeContractAsync],
  );

  const resetTrade = useCallback(() => {
    setStep("IDLE");
    setTxHash(null);
    setErrorMessage(null);
  }, []);

  return {
    executeTrade,
    resetTrade,
    step,
    txHash,
    errorMessage,
    isPending:
      step === "APPROVING" || step === "EXECUTING" || step === "CONFIRMING",
  };
}
