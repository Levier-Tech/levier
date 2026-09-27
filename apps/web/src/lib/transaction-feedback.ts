import type { Address, Hex, PublicClient } from "viem";

export type TransactionResult = {
  status: "success" | "failed" | "cancelled" | "unconfirmed";
  title: string;
  description: string;
  hash?: Hex;
  transactionLabel?: string;
};

export function transactionFailure(
  error: unknown,
  submitted?: { hash: Hex; transactionLabel: string },
  message?: string,
): TransactionResult {
  const codes: string[] = [];
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    codes.push(String(item.code), String(item.name));
    if (typeof item.message === "string" && /^[A-Z_]+$/.test(item.message))
      codes.push(item.message);
    current = item.cause;
  }
  if (
    codes.some((c) =>
      ["4001", "UserRejectedRequestError", "ACTION_REJECTED"].includes(c),
    )
  )
    return {
      ...submitted,
      status: "cancelled",
      title: "Request cancelled",
      description:
        "The wallet request was declined. Any earlier confirmed approval remains valid; no new signature was accepted for this step.",
    };
  if (codes.includes("TRANSACTION_REVERTED"))
    return {
      ...submitted,
      status: "failed",
      title: "Transaction failed",
      description:
        "The transaction reverted onchain. This transaction did not apply the requested action, but a gas fee may have been charged.",
    };
  if (
    codes.some((c) =>
      ["INSUFFICIENT_GAS", "InsufficientFundsError"].includes(c),
    )
  )
    return {
      ...submitted,
      status: "failed",
      title: "Insufficient gas balance",
      description:
        "Add ETH on the configured network to pay the estimated network fee, then try again. Token balances cannot pay this fee.",
    };
  if (submitted)
    return {
      ...submitted,
      status: "unconfirmed",
      title: "Action not verified",
      description: `${message ? `${message} ` : ""}We could not verify completion of this action. The link shows the last submitted transaction, which may be an approval. Check its status and your position before retrying.`,
    };
  return {
    status: "failed",
    title: "Request could not be completed",
    description:
      message ??
      "The wallet request or transaction check did not complete. Refresh your balances and review the network, amount and market availability.",
  };
}

export async function ensureGasBalance(
  client: PublicClient,
  account: Address,
  gas: bigint,
) {
  const [balance, gasPrice] = await Promise.all([
    client.getBalance({ address: account }),
    client.getGasPrice(),
  ]);
  if (balance === 0n || balance < gas * gasPrice)
    throw new Error("INSUFFICIENT_GAS");
}
