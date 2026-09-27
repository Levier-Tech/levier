"use client";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, type Address, type PublicClient } from "viem";
import { env } from "../env.mjs";
export function useWalletGas(
  client: PublicClient | undefined,
  account: Address | undefined,
  chainId: number | undefined,
) {
  return useQuery({
    queryKey: ["wallet-gas", account, chainId],
    queryFn: () => client!.getBalance({ address: account! }),
    enabled: !!client && !!account && chainId === env.CHAIN_ID,
    refetchInterval: env.UI_POLL_INTERVAL_MS,
    retry: false,
  });
}
export function WalletFunds({
  symbol,
  decimals,
  balance,
  required,
  gas,
  gasError,
  spending,
}: {
  symbol: string;
  decimals: number;
  balance?: bigint;
  required?: bigint;
  gas?: bigint;
  gasError: boolean;
  spending: boolean;
}) {
  const shortfall =
    balance !== undefined && required !== undefined && required > balance
      ? required - balance
      : null;
  return (
    <div className="wallet-funds" aria-live="polite">
      <div>
        <span>Wallet {symbol}</span>
        <strong>
          {balance === undefined
            ? "Not verified"
            : formatUnits(balance, decimals)}
        </strong>
      </div>
      <div>
        <span>{env.NATIVE_CURRENCY_SYMBOL} for network fees</span>
        <strong>
          {gas === undefined
            ? gasError
              ? "Unavailable"
              : "Checking…"
            : formatUnits(gas, env.NATIVE_CURRENCY_DECIMALS)}
        </strong>
      </div>
      {shortfall !== null ? (
        <p className="form-warning">
          Insufficient {symbol}. Add {formatUnits(shortfall, decimals)} {symbol}{" "}
          or enter a smaller amount.
        </p>
      ) : (
        spending &&
        balance === 0n && (
          <p className="form-warning">
            No {symbol} in this wallet. Add {symbol} on the connected network
            before submitting this action.
          </p>
        )
      )}
      {gas === 0n && (
        <p className="form-warning">
          Add {env.NATIVE_CURRENCY_SYMBOL} on the connected network to pay
          transaction fees. Tokens cannot be used for gas.
        </p>
      )}
      {gasError && (
        <p className="form-warning">
          The gas balance could not be verified. Refresh before continuing.
        </p>
      )}
    </div>
  );
}
