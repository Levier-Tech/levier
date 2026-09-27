'use client';

import { useAccount, useConnect, useDisconnect, useSwitchChain, useChainId } from 'wagmi';

export function useWeb3Wallet() {
  const { address, isConnected, isConnecting, isDisconnected, status } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const formattedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : undefined;

  return {
    address,
    formattedAddress,
    isConnected,
    isConnecting,
    isDisconnected,
    status,
    chainId,
    connectors,
    connect,
    disconnect,
    switchChain,
    isConnectPending,
  };
}
