"use client";

import { useAccount, useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { getAddresses } from "../contracts/addresses";
import { NetworkMode } from "@levier/types";

export function useTokenBalances(
  networkMode: NetworkMode,
  tokenSymbol: string = "USDG",
) {
  const { address } = useAccount();
  const addresses = getAddresses(networkMode);
  const tokenAddress = addresses.tokens[tokenSymbol];

  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!address && !!tokenAddress },
  });
  const { data: usdgDecimals } = useReadContract({
    address: addresses.usdg,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!address },
  });
  // Read Token Balance
  const {
    data: rawBalance,
    refetch: refetchBalance,
    isLoading: isBalanceLoading,
  } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!tokenAddress,
    },
  });

  // Read USDG Balance (Collateral)
  const {
    data: rawUsdgBalance,
    refetch: refetchUsdgBalance,
    isLoading: isUsdgLoading,
  } = useReadContract({
    address: addresses.usdg,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Check Allowance for LeverageRouter
  const { data: rawAllowance, refetch: refetchAllowance } = useReadContract({
    address: addresses.usdg,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, addresses.leverageRouter] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const formattedBalance =
    rawBalance !== undefined && tokenDecimals !== undefined
      ? parseFloat(formatUnits(rawBalance, tokenDecimals))
      : 0;
  const formattedUsdgBalance =
    rawUsdgBalance !== undefined && usdgDecimals !== undefined
      ? parseFloat(formatUnits(rawUsdgBalance, usdgDecimals))
      : 0;
  const formattedAllowance =
    rawAllowance !== undefined && usdgDecimals !== undefined
      ? parseFloat(formatUnits(rawAllowance, usdgDecimals))
      : 0;

  return {
    balance: formattedBalance,
    usdgBalance: formattedUsdgBalance,
    balanceAvailable:
      !!address && rawUsdgBalance !== undefined && usdgDecimals !== undefined,
    allowance: formattedAllowance,
    isLoading: isBalanceLoading || isUsdgLoading,
    refetch: () => {
      refetchBalance();
      refetchUsdgBalance();
      refetchAllowance();
    },
  };
}
