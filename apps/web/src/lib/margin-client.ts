import { isSupportedChainId } from "./networks";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { ensureGasBalance } from "./transaction-feedback";
import { MarginRouterABI } from "../contracts/generated/margin";
import { LevierPairABI } from "../contracts/generated/lending";
import {
  readLendingSnapshot,
  type LendingDeployment,
  exactAmount,
} from "./lending-client";
export type MarginDeployment = {
  chainId: number;
  owner: Address;
  router: Address;
  factory: Address;
  pool: Address;
  longPair: Address;
  short: LendingDeployment;
  codeHashes: { router: Hex; factory: Hex; pool: Hex };
  policy: {
    maxMarginRaw: string;
    slippageBps: number;
    deadlineSeconds: number;
    gasBufferBps: number;
    maxGasLimit: string;
    longLeveragesBps: number[];
    shortExposureBps: number[];
  };
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export class MarginError extends Error {}
const check = (condition: unknown, code: string) => {
  if (!condition) throw new MarginError(code);
};
export async function readMarginSnapshot(
  client: PublicClient,
  d: MarginDeployment,
  long: LendingDeployment,
  account: Address,
) {
  check(
    isSupportedChainId(d.chainId) && (await client.getChainId()) === d.chainId,
    "WRONG_NETWORK",
  );
  check(
    same(long.pair, d.longPair) &&
      same(long.collateral, d.short.debt) &&
      same(long.debt, d.short.collateral) &&
      same(long.registry, d.short.registry),
    "MARGIN_IDENTITY_MISMATCH",
  );
  const blockNumber = await client.getBlockNumber();
  for (const role of ["router", "factory", "pool"] as const) {
    const code = await client.getCode({ address: d[role], blockNumber });
    check(
      code && same(keccak256(code), d.codeHashes[role]),
      "MARGIN_CODE_MISMATCH",
    );
  }
  const read = (
    functionName:
      "stock" | "stable" | "longPair" | "shortPair" | "pool" | "owner",
  ) =>
    client.readContract({
      address: d.router,
      abi: MarginRouterABI,
      functionName,
      blockNumber,
    });
  const refs = await Promise.all(
    ["stock", "stable", "longPair", "shortPair", "pool", "owner"].map((x) =>
      read(x as Parameters<typeof read>[0]),
    ),
  );
  const expected = [
    long.collateral,
    long.debt,
    long.pair,
    d.short.pair,
    d.pool,
    d.owner,
  ];
  check(
    refs.every((x, i) => same(x, expected[i])),
    "MARGIN_IDENTITY_MISMATCH",
  );
  const [longPosition, shortPosition, paused, reserves] = await Promise.all([
    readLendingSnapshot(client, long, account, blockNumber),
    readLendingSnapshot(client, d.short, account, blockNumber),
    client.readContract({
      address: d.router,
      abi: MarginRouterABI,
      functionName: "isPaused",
      blockNumber,
    }),
    client.readContract({
      address: d.router,
      abi: MarginRouterABI,
      functionName: "reserves",
      blockNumber,
    }),
  ]);
  const priceAbi = [
    {
      type: "function",
      name: "getPrice",
      stateMutability: "view",
      inputs: [{ name: "asset", type: "address" }],
      outputs: [{ name: "price", type: "uint256" }],
    },
  ] as const;
  const prices = await Promise.allSettled(
    [d.short.collateral, d.short.debt].map((asset) =>
      client.readContract({
        address: d.short.oracle,
        abi: priceAbi,
        functionName: "getPrice",
        args: [asset],
        blockNumber,
      }),
    ),
  );
  const [stable, stock] = prices;
  const closes = await Promise.allSettled(
    [false, true].map((isShort) =>
      client.readContract({
        address: d.router,
        abi: MarginRouterABI,
        functionName: "quoteClose",
        args: [isShort, account],
        blockNumber,
      }),
    ),
  );
  return {
    blockNumber,
    longPosition,
    shortPosition,
    paused,
    reserves,
    closeQuotes: closes.map((q) => (q.status === "fulfilled" ? q.value : null)),
    shortStablePrice:
      stable.status === "fulfilled" && stable.value > 0n ? stable.value : null,
    shortStockPrice:
      stock.status === "fulfilled" && stock.value > 0n ? stock.value : null,
  };
}
export type MarginSnapshot = Awaited<ReturnType<typeof readMarginSnapshot>>;
export function assertMarginOpeningAvailable(
  s: MarginSnapshot,
  isShort: boolean,
) {
  const position = isShort ? s.shortPosition : s.longPosition;
  check(!s.paused, "ROUTER_PAUSED");
  check(position.status === 0, "MARKET_PAUSED");
  check(position.oracleAvailable, "ORACLE_UNAVAILABLE");
  check(
    position.collateral === 0n && position.debt === 0n,
    "EXISTING_POSITION",
  );
}

// Only known contract reasons are converted to displayable codes. Provider text
// may contain credentials and must never be passed through to the interface.
function marginPreflightError(error: unknown): never {
  const reasons: Record<string, string> = {
    "Margin: Paused": "ROUTER_PAUSED",
    "Margin: Expired": "QUOTE_EXPIRED",
    "Margin: Slippage": "QUOTE_CHANGED",
    "Margin: Existing position": "EXISTING_POSITION",
    "Margin: Insufficient equity": "CLOSE_UNAVAILABLE",
    "Margin: Insufficient liquidity": "BORROW_LIQUIDITY_UNAVAILABLE",
    "Margin: No liquidity": "POOL_UNAVAILABLE",
  };
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const item = current as {
      reason?: unknown;
      data?: { errorName?: string; args?: unknown[] };
      cause?: unknown;
    };
    const reason =
      typeof item.reason === "string"
        ? item.reason
        : item.data?.errorName === "Error"
          ? item.data.args?.[0]
          : undefined;
    if (typeof reason === "string" && reasons[reason])
      throw new MarginError(reasons[reason]);
    current = item.cause;
  }
  throw error;
}
export function v2Output(
  amount: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) {
  check(amount > 0n && reserveIn > 0n && reserveOut > 0n, "POOL_UNAVAILABLE");
  const adjusted = amount * 997n;
  return (adjusted * reserveOut) / (reserveIn * 1000n + adjusted);
}
export function marginOrder(
  d: MarginDeployment,
  long: LendingDeployment,
  s: MarginSnapshot,
  isShort: boolean,
  input: string,
  multipleBps: number,
) {
  const margin = exactAmount(input, long.debtDecimals);
  check(margin <= BigInt(d.policy.maxMarginRaw), "MARGIN_LIMIT_EXCEEDED");
  check(margin <= s.longPosition.debtBalance, "INSUFFICIENT_USDG");
  check(
    (isShort ? d.policy.shortExposureBps : d.policy.longLeveragesBps).includes(
      multipleBps,
    ),
    "UNSUPPORTED_EXPOSURE",
  );
  const position = isShort ? s.shortPosition : s.longPosition;
  assertMarginOpeningAvailable(s, isShort);
  let debt: bigint;
  if (isShort) {
    check(
      s.shortStablePrice !== null && s.shortStockPrice !== null,
      "ORACLE_UNAVAILABLE",
    );
    debt =
      (margin *
        s.shortStablePrice! *
        BigInt(multipleBps) *
        10n ** BigInt(long.collateralDecimals)) /
      (10n ** BigInt(long.debtDecimals) * 10000n * s.shortStockPrice!);
  } else debt = (margin * BigInt(multipleBps - 10000)) / 10000n;
  check(
    debt > 0n && debt <= position.liquidity,
    "BORROW_LIQUIDITY_UNAVAILABLE",
  );
  const [stockReserve, stableReserve] = s.reserves;
  const output = isShort
    ? v2Output(debt, stockReserve, stableReserve)
    : v2Output(margin + debt, stableReserve, stockReserve);
  const minOutput = (output * BigInt(10000 - d.policy.slippageBps)) / 10000n;
  check(minOutput > 0n, "AMOUNT_TOO_SMALL");
  return {
    margin,
    debt,
    collateral: isShort ? margin + output : output,
    minCollateral: isShort ? margin + minOutput : minOutput,
  };
}
export async function executeMarginAction(options: {
  client: PublicClient;
  wallet: WalletClient;
  deployment: MarginDeployment;
  long: LendingDeployment;
  account: Address;
  enabled: boolean;
  isShort: boolean;
  action: "open" | "close";
  input: string;
  multipleBps: number;
  confirmations: number;
  timeoutMs: number;
  onStage: (stage: string, hash?: Hex) => void;
}) {
  const {
    client,
    wallet,
    deployment: d,
    long,
    account,
    isShort,
    onStage,
  } = options;
  check(options.action === "close" || options.enabled, "EXECUTION_DISABLED");
  check(
    Number.isSafeInteger(options.confirmations) &&
      options.confirmations > 0 &&
      Number.isSafeInteger(options.timeoutMs) &&
      options.timeoutMs > 0,
    "INVALID_RECEIPT_POLICY",
  );
  const guard = async () => {
    const [chain, accounts] = await Promise.all([
      wallet.getChainId(),
      wallet.getAddresses(),
    ]);
    check(
      chain === d.chainId && accounts[0] && same(accounts[0], account),
      "WALLET_CHANGED",
    );
  };
  const send = async (to: Address, data: Hex, label: string) => {
    await guard();
    const current = await readMarginSnapshot(client, d, long, account);
    // A publisher can pause while the wallet confirms an approval. Stop before
    // asking for another signature; closing keeps its independent recovery path.
    if (options.action === "open")
      assertMarginOpeningAvailable(current, isShort);
    let estimate: bigint;
    try {
      await client.call({ account, to, data, value: 0n });
      estimate = await client.estimateGas({ account, to, data, value: 0n });
    } catch (error) {
      marginPreflightError(error);
    }
    const gas = (estimate * BigInt(d.policy.gasBufferBps) + 9999n) / 10000n;
    check(gas <= BigInt(d.policy.maxGasLimit), "GAS_LIMIT_EXCEEDED");
    await ensureGasBalance(client, account, gas);
    await guard();
    onStage(label);
    const hash = await wallet.sendTransaction({
      account,
      chain: wallet.chain,
      to,
      data,
      gas,
      value: 0n,
    });
    onStage("Waiting for confirmation", hash);
    let replaced = false;
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: options.confirmations,
      timeout: options.timeoutMs,
      onReplaced: (r) => {
        if (r.reason !== "repriced") replaced = true;
      },
    });
    onStage("Checking transaction receipt", receipt.transactionHash);
    check(!replaced, "TRANSACTION_REPLACED_OR_CANCELLED");
    check(receipt.status === "success", "TRANSACTION_REVERTED");
    const tx = await client.getTransaction({ hash: receipt.transactionHash });
    check(
      tx.to &&
        same(tx.to, to) &&
        same(tx.from, account) &&
        tx.input === data &&
        tx.value === 0n,
      "TRANSACTION_IDENTITY_MISMATCH",
    );
    check(
      (await client.getBlock({ blockNumber: receipt.blockNumber })).hash ===
        receipt.blockHash,
      "RECEIPT_REORGED",
    );
    return receipt;
  };
  onStage("Checking contracts and wallet");
  await guard();
  const snapshot = await readMarginSnapshot(client, d, long, account),
    pair = isShort ? d.short.pair : long.pair;
  const order =
    options.action === "open"
      ? marginOrder(
          d,
          long,
          snapshot,
          isShort,
          options.input,
          options.multipleBps,
        )
      : null;
  if (order) {
    const allowance = () =>
      client.readContract({
        address: long.debt,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, d.router],
      });
    const existing = await allowance();
    if (existing < order.margin) {
      if (existing > 0n) {
        await send(
          long.debt,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [d.router, 0n],
          }),
          "Reset USDG approval",
        );
        check((await allowance()) === 0n, "APPROVAL_NOT_CONFIRMED");
      }
      await send(
        long.debt,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [d.router, order.margin],
        }),
        "Approve exact USDG margin",
      );
      check((await allowance()) >= order.margin, "APPROVAL_NOT_CONFIRMED");
    }
  }
  const operator = () =>
    client.readContract({
      address: pair,
      abi: LevierPairABI,
      functionName: "approvedOperators",
      args: [account, d.router],
    });
  if (!(await operator())) {
    await send(
      pair,
      encodeFunctionData({
        abi: LevierPairABI,
        functionName: "setOperator",
        args: [d.router, true],
      }),
      "Authorize the margin router for your position",
    );
    check(await operator(), "OPERATOR_NOT_CONFIRMED");
  }
  const deadline =
    (await client.getBlock()).timestamp + BigInt(d.policy.deadlineSeconds);
  let data: Hex;
  if (order)
    data = encodeFunctionData({
      abi: MarginRouterABI,
      functionName: "open",
      args: [isShort, order.margin, order.debt, order.minCollateral, deadline],
    });
  else {
    const quoted = await client.readContract({
      address: d.router,
      abi: MarginRouterABI,
      functionName: "quoteClose",
      args: [isShort, account],
    });
    const minimum = (quoted * BigInt(10000 - d.policy.slippageBps)) / 10000n;
    check(minimum > 0n, "CLOSE_UNAVAILABLE");
    data = encodeFunctionData({
      abi: MarginRouterABI,
      functionName: "close",
      args: [isShort, minimum, deadline],
    });
  }
  const receipt = await send(
    d.router,
    data,
    options.action === "open"
      ? "Confirm opening position"
      : "Confirm closing position",
  );
  const matched = receipt.logs
    .filter((log) => same(log.address, d.router))
    .flatMap((log) => {
      try {
        const e = decodeEventLog({
          abi: MarginRouterABI,
          data: log.data,
          topics: log.topics,
        });
        if (
          e.eventName === (order ? "PositionOpened" : "PositionClosed") &&
          "user" in e.args &&
          same(e.args.user, account) &&
          e.args.isShort === isShort
        )
          return [e];
      } catch {}
      return [];
    });
  check(matched.length === 1, "POSITION_EVENT_MISMATCH");
  if (order) {
    const event = matched[0];
    check(
      event.eventName === "PositionOpened" &&
        event.args.margin === order.margin &&
        event.args.debt === order.debt &&
        event.args.collateral >= order.minCollateral,
      "POSITION_EVENT_MISMATCH",
    );
  }
  const position = await client.readContract({
    address: pair,
    abi: LevierPairABI,
    functionName: "accounts",
    args: [account],
    blockNumber: receipt.blockNumber,
  });
  if (order) {
    const opened = matched[0];
    check(
      opened.eventName === "PositionOpened" &&
        position[0] === opened.args.collateral &&
        position[1] === opened.args.debt,
      "POSITION_STATE_MISMATCH",
    );
  } else check(position[0] === 0n && position[1] === 0n, "POSITION_NOT_CLOSED");
  onStage(
    options.action === "open"
      ? "Position opened and verified"
      : "Position closed and verified",
    receipt.transactionHash,
  );
  return receipt.transactionHash;
}
