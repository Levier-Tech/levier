import { lendingRisk } from "./lending-risk";
import { ensureGasBalance } from "./transaction-feedback";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseUnits,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  LevierPairABI,
  LevierMarketRegistryABI,
} from "../contracts/generated/lending";

export type LendingDeployment = {
  chainId: number;
  marketId: Hex;
  pair: Address;
  registry: Address;
  oracle: Address;
  collateral: Address;
  debt: Address;
  collateralSymbol: string;
  debtSymbol: string;
  collateralDecimals: number;
  debtDecimals: number;
  codeHashes: Record<
    "pair" | "registry" | "oracle" | "collateral" | "debt",
    Hex
  >;
};
export type LendingAction = "deposit" | "borrow" | "repay" | "withdraw";
export type TransactionStage =
  | "CHECKING"
  | "APPROVING"
  | "CONFIRMING_APPROVAL"
  | "SIMULATING"
  | "SIGNING"
  | "CONFIRMING"
  | "CONFIRMED";
export class LendingError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function exactAmount(input: string, decimals: number): bigint {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !/^\d+(\.\d+)?$/.test(input) ||
    input.length > 120
  )
    throw new LendingError("INVALID_AMOUNT");
  if ((input.split(".")[1]?.length ?? 0) > decimals)
    throw new LendingError("TOO_MANY_DECIMALS");
  const amount = parseUnits(input, decimals);
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new LendingError("INVALID_AMOUNT");
  return amount;
}
export async function readLendingSnapshot(
  client: PublicClient,
  deployment: LendingDeployment,
  account: Address,
  atBlock?: bigint,
) {
  if (
    deployment.chainId !== 46630 ||
    (await client.getChainId()) !== deployment.chainId
  )
    throw new LendingError("WRONG_NETWORK");
  const blockNumber = atBlock ?? (await client.getBlockNumber());
  for (const role of [
    "pair",
    "registry",
    "oracle",
    "collateral",
    "debt",
  ] as const) {
    const code = await client.getCode({
      address: deployment[role],
      blockNumber,
    });
    if (
      !code ||
      code === "0x" ||
      !same(keccak256(code), deployment.codeHashes[role])
    )
      throw new LendingError("CONTRACT_IDENTITY_MISMATCH");
  }
  const pair = {
    address: deployment.pair,
    abi: LevierPairABI,
    blockNumber,
  } as const;
  const [
    collateral,
    debt,
    registry,
    oracle,
    marketId,
    collateralDecimals,
    debtDecimals,
    collateralSymbol,
    debtSymbol,
  ] = await Promise.all([
    client.readContract({ ...pair, functionName: "collateralToken" }),
    client.readContract({ ...pair, functionName: "debtToken" }),
    client.readContract({ ...pair, functionName: "registry" }),
    client.readContract({ ...pair, functionName: "oracle" }),
    client.readContract({ ...pair, functionName: "marketId" }),
    client.readContract({
      address: deployment.collateral,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: deployment.debt,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: deployment.collateral,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    }),
    client.readContract({
      address: deployment.debt,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    }),
  ]);
  if (
    !same(collateral, deployment.collateral) ||
    !same(debt, deployment.debt) ||
    !same(registry, deployment.registry) ||
    !same(oracle, deployment.oracle) ||
    !same(marketId, deployment.marketId) ||
    collateralDecimals !== deployment.collateralDecimals ||
    debtDecimals !== deployment.debtDecimals ||
    collateralSymbol !== deployment.collateralSymbol ||
    debtSymbol !== deployment.debtSymbol
  )
    throw new LendingError("MARKET_IDENTITY_MISMATCH");
  const [market, position, collateralBalance, debtBalance, liquidity] =
    await Promise.all([
      client.readContract({
        address: registry,
        abi: LevierMarketRegistryABI,
        functionName: "getMarket",
        args: [marketId],
        blockNumber,
      }),
      client.readContract({
        ...pair,
        functionName: "accounts",
        args: [account],
      }),
      client.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
        blockNumber,
      }),
      client.readContract({
        address: debt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
        blockNumber,
      }),
      client.readContract({
        address: debt,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deployment.pair],
        blockNumber,
      }),
    ]);
  if (
    !same(market.pairAddress, deployment.pair) ||
    !same(market.collateralToken, collateral) ||
    !same(market.debtToken, debt) ||
    !same(market.oracle, oracle) ||
    !same(market.marketId, marketId)
  )
    throw new LendingError("REGISTRY_IDENTITY_MISMATCH");
  // An expired oracle must not hide balances or block debt repayment/recovery.
  const prices = await Promise.allSettled(
    [collateral, debt].map((asset) =>
      client.readContract({
        address: oracle,
        abi: parseAbi(["function getPrice(address) view returns(uint256)"]),
        functionName: "getPrice",
        args: [asset],
        blockNumber,
      }),
    ),
  );
  const oracleAvailable = prices.every(
    (price) => price.status === "fulfilled" && price.value > 0n,
  );
  const [totalCollateral, totalDebt] = await Promise.all([
    client.readContract({ ...pair, functionName: "totalSupplyCollateral" }),
    client.readContract({ ...pair, functionName: "totalBorrowedDebt" }),
  ]);
  const limits = lendingRisk({
    collateral: position[0],
    debt: position[1],
    collateralBalance,
    debtBalance,
    liquidity,
    totalCollateral,
    totalDebt,
    supplyCap: market.supplyCap,
    borrowCap: market.borrowCap,
    maxLtvBps: market.maxLtvBps,
    liquidationLtvBps: market.liquidationLtvBps,
    collateralDecimals,
    debtDecimals,
    collateralPrice:
      oracleAvailable && prices[0].status === "fulfilled"
        ? prices[0].value
        : null,
    debtPrice:
      oracleAvailable && prices[1].status === "fulfilled"
        ? prices[1].value
        : null,
    status: market.status,
  });
  return {
    limits,
    oracleAvailable,
    blockNumber,
    collateral: position[0],
    debt: position[1],
    collateralBalance,
    debtBalance,
    liquidity,
    status: market.status,
  };
}
export type LendingSnapshot = Awaited<ReturnType<typeof readLendingSnapshot>>;
export function validateAction(
  action: LendingAction,
  amount: bigint,
  snapshot: LendingSnapshot,
) {
  if (action === "deposit" && amount > snapshot.collateralBalance)
    throw new LendingError("INSUFFICIENT_COLLATERAL_BALANCE");
  if (action === "repay" && amount > snapshot.debtBalance)
    throw new LendingError("INSUFFICIENT_USDG");
  if (
    action === "deposit" &&
    (![0, 1].includes(snapshot.status) || amount > snapshot.collateralBalance)
  )
    throw new LendingError("DEPOSIT_UNAVAILABLE");
  if (
    action === "borrow" &&
    (snapshot.status !== 0 ||
      !snapshot.oracleAvailable ||
      amount > snapshot.liquidity)
  )
    throw new LendingError("BORROW_UNAVAILABLE");
  if (action === "deposit" && amount > snapshot.limits.depositMax)
    throw new LendingError("DEPOSIT_CAP_EXCEEDED");
  if (
    action === "borrow" &&
    (snapshot.limits.borrowMax === null || amount > snapshot.limits.borrowMax)
  )
    throw new LendingError("BORROW_LIMIT_EXCEEDED");
  if (
    action === "repay" &&
    (amount > snapshot.debt || amount > snapshot.debtBalance)
  )
    throw new LendingError("REPAY_EXCEEDS_DEBT_OR_BALANCE");
  if (action === "withdraw" && snapshot.debt > 0n && !snapshot.oracleAvailable)
    throw new LendingError("ORACLE_UNAVAILABLE");
  if (action === "withdraw" && amount > snapshot.collateral)
    throw new LendingError("WITHDRAW_EXCEEDS_COLLATERAL");
  if (
    action === "withdraw" &&
    snapshot.limits.withdrawMax !== null &&
    snapshot.debt > 0n &&
    amount > snapshot.limits.withdrawMax
  )
    throw new LendingError("WITHDRAW_BREACHES_LTV");
}
export function verifyPairEvent(
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[],
  deployment: LendingDeployment,
  account: Address,
  action: LendingAction,
  amount: bigint,
) {
  const expected = {
    deposit: "CollateralDeposited",
    borrow: "DebtBorrowed",
    repay: "DebtRepaid",
    withdraw: "CollateralWithdrawn",
  }[action];
  let matched = 0;
  for (const log of logs) {
    if (!same(log.address, deployment.pair)) continue;
    try {
      const event = decodeEventLog({
        abi: LevierPairABI,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (
        "user" in event.args &&
        "amount" in event.args &&
        event.eventName === expected &&
        same(event.args.user, account) &&
        event.args.amount === amount
      )
        matched++;
    } catch {
      /* Unrelated events cannot confirm this action. */
    }
  }
  if (matched !== 1) throw new LendingError("RECEIPT_EVENT_MISMATCH");
}
export async function executeLendingAction(options: {
  client: PublicClient;
  wallet: WalletClient;
  deployment: LendingDeployment;
  account: Address;
  enabled: boolean;
  action: LendingAction;
  input: string;
  confirmations: number;
  timeoutMs: number;
  onStage: (stage: TransactionStage, hash?: Hex) => void;
}) {
  const { client, wallet, deployment, account, action, onStage } = options;
  if (!options.enabled) throw new LendingError("EXECUTION_DISABLED");
  if (
    !Number.isSafeInteger(options.confirmations) ||
    options.confirmations < 1 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0
  )
    throw new LendingError("INVALID_RECEIPT_POLICY");
  const guardWallet = async () => {
    const [chainId, addresses] = await Promise.all([
      wallet.getChainId(),
      wallet.getAddresses(),
    ]);
    if (
      chainId !== deployment.chainId ||
      !addresses[0] ||
      !same(addresses[0], account)
    )
      throw new LendingError("WALLET_CHANGED");
  };
  const send = async (to: Address, data: Hex, approval: boolean) => {
    await guardWallet();
    await readLendingSnapshot(client, deployment, account);
    // Simulate each exact call, including token approvals, before asking for a signature.
    await client.call({ account, to, data, value: 0n });
    const gas = await client.estimateGas({ account, to, data, value: 0n });
    await ensureGasBalance(client, account, gas);
    await guardWallet();
    onStage(approval ? "APPROVING" : "SIGNING");
    const hash = await wallet.sendTransaction({
      account,
      chain: wallet.chain,
      to,
      data,
      value: 0n,
      gas,
    });
    onStage(approval ? "CONFIRMING_APPROVAL" : "CONFIRMING", hash);
    let changed = false;
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: options.confirmations,
      timeout: options.timeoutMs,
      onReplaced: (replacement) => {
        if (replacement.reason !== "repriced") changed = true;
      },
    });
    onStage(
      approval ? "CONFIRMING_APPROVAL" : "CONFIRMING",
      receipt.transactionHash,
    );
    if (changed) throw new LendingError("TRANSACTION_REPLACED_OR_CANCELLED");
    if (receipt.status !== "success")
      throw new LendingError("TRANSACTION_REVERTED");
    const tx = await client.getTransaction({ hash: receipt.transactionHash });
    if (
      !tx.to ||
      !same(tx.to, to) ||
      !same(tx.from, account) ||
      tx.input !== data ||
      tx.value !== 0n
    )
      throw new LendingError("TRANSACTION_IDENTITY_MISMATCH");
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw new LendingError("RECEIPT_REORGED");
    return receipt;
  };
  onStage("CHECKING");
  await guardWallet();
  let snapshot = await readLendingSnapshot(client, deployment, account);
  const isCollateral = action === "deposit" || action === "withdraw";
  const amount = exactAmount(
    options.input,
    isCollateral ? deployment.collateralDecimals : deployment.debtDecimals,
  );
  validateAction(action, amount, snapshot);
  if (action === "deposit" || action === "repay") {
    const token =
      action === "deposit" ? deployment.collateral : deployment.debt;
    const readAllowance = () =>
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, deployment.pair],
      });
    const allowance = await readAllowance();
    if (allowance < amount) {
      if (allowance > 0n) {
        await send(
          token,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [deployment.pair, 0n],
          }),
          true,
        );
        if ((await readAllowance()) !== 0n)
          throw new LendingError("APPROVAL_NOT_CONFIRMED");
      }
      await send(
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.pair, amount],
        }),
        true,
      );
      if ((await readAllowance()) < amount)
        throw new LendingError("APPROVAL_NOT_CONFIRMED");
    }
  }
  snapshot = await readLendingSnapshot(client, deployment, account);
  validateAction(action, amount, snapshot);
  onStage("SIMULATING");
  const functionName = {
    deposit: "depositCollateral",
    borrow: "borrow",
    repay: "repay",
    withdraw: "withdrawCollateral",
  }[action] as "depositCollateral" | "borrow" | "repay" | "withdrawCollateral";
  const data = encodeFunctionData({
    abi: LevierPairABI,
    functionName,
    args: [amount],
  });
  const receipt = await send(deployment.pair, data, false);
  verifyPairEvent(receipt.logs, deployment, account, action, amount);
  onStage("CONFIRMED", receipt.transactionHash);
  return { hash: receipt.transactionHash, blockNumber: receipt.blockNumber };
}
