import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { env } from "../env.mjs";
import { ensureGasBalance } from "./transaction-feedback";

// Pons leverage (PonsPerpManager + PonsLiquidityVault + PonsV4TwapOracle). Amounts are USDG (6 decimals).
export const USDG_DECIMALS = 6;
export const BPS = 10_000n;

export const ponsManagerAbi = parseAbi([
  "function openingPaused() view returns (bool)",
  "function feeBps() view returns (uint16)",
  "function minHoldTime() view returns (uint32)",
  "function markets(address) view returns (bool listed, uint16 maxLeverageBps, uint16 maintenanceMarginBps, uint128 maxPositionSize, uint128 maxOpenInterest, uint128 openInterest)",
  "function positions(uint256) view returns (address trader, address asset, bool isLong, uint64 openedAt, uint128 collateral, uint128 size, uint256 entryPrice)",
  "function positionsOf(address) view returns (uint256[])",
  "function previewPosition(uint256) view returns (int256 pnl, int256 equity, bool liquidatable)",
  "function openPosition(address asset, bool isLong, uint256 collateral, uint256 leverageBps) returns (uint256)",
  "function closePosition(uint256 id)",
  "error OpeningPaused()",
  "error MarketNotListed()",
  "error NotGraduated()",
  "error InvalidLeverage()",
  "error PositionTooLarge()",
  "error OpenInterestCap()",
  "error UtilizationCap()",
  "error NotTrader()",
  "error UnknownPosition()",
  "error MinHoldTime()",
  "error NotLiquidatable()",
  "error PoolNotInitialized()",
  "error TwapNotReady()",
  "error PriceDeviation(uint256 spot, uint256 twap)",
  "error InsufficientFreeLiquidity()",
]);
export const ponsOracleAbi = parseAbi([
  "function peek(address) view returns (uint256 spotUsd, uint256 twapUsd)",
  "error UnknownAsset()",
  "error PoolNotInitialized()",
  "error TwapNotReady()",
  "error PriceDeviation(uint256 spot, uint256 twap)",
]);
export const ponsVaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function reserved() view returns (uint256)",
  "function freeAssets() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

export const ponsDeployment = env.PONS_DEPLOYMENT_JSON;
export const ponsEnabled = env.PONS_TRADING_ENABLED && !!ponsDeployment;

/** Listed Pons token for a symbol or address, if any. */
export function ponsMarketFor(symbolOrAddress: string | undefined): { symbol: string; token: Address } | null {
  if (!ponsDeployment || !symbolOrAddress) return null;
  const key = symbolOrAddress.toLowerCase();
  for (const [symbol, token] of Object.entries(ponsDeployment.markets as Record<string, string>))
    if (symbol.toLowerCase() === key || token.toLowerCase() === key) return { symbol, token: token as Address };
  return null;
}

const errorText: Record<string, string> = {
  OpeningPaused: "New positions are paused.",
  MarketNotListed: "This token is not listed for leverage.",
  NotGraduated: "Leverage opens after this token graduates from the Pons bonding curve.",
  InvalidLeverage: "Leverage is outside the market limit.",
  PositionTooLarge: "Position is above the per-position cap.",
  OpenInterestCap: "The market's open-interest cap is reached.",
  UtilizationCap: "The LP vault has no free liquidity for this size.",
  InsufficientFreeLiquidity: "The LP vault has no free liquidity for this size.",
  NotTrader: "Only the position owner can close it.",
  MinHoldTime: "Positions must stay open for the minimum hold time first.",
  PoolNotInitialized: "This token has no Uniswap v4 pool yet (not graduated).",
  TwapNotReady: "The price average is warming up. Try again in a few minutes.",
  PriceDeviation: "The pool price moved too far from its average. Try again later.",
  UnknownAsset: "This token is not listed on the price oracle.",
};

/** Readable reason for a contract revert, or null when the error is not a known revert. */
export function ponsRevertReason(error: unknown): string | null {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return errorText[name] ?? null;
    }
  }
  return null;
}

export type PonsPrices = { spotUsd: bigint; twapUsd: bigint } | { unavailable: string };

export async function readPonsMarket(client: PublicClient, token: Address, account?: Address) {
  const d = ponsDeployment!;
  const [market, openingPaused, feeBps, minHoldTime, freeAssets] = await Promise.all([
    client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "markets", args: [token] }),
    client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "openingPaused" }),
    client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "feeBps" }),
    client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "minHoldTime" }),
    client.readContract({ address: d.vault, abi: ponsVaultAbi, functionName: "freeAssets" }),
  ]);
  let prices: PonsPrices;
  try {
    const [spotUsd, twapUsd] = await client.readContract({ address: d.oracle, abi: ponsOracleAbi, functionName: "peek", args: [token] });
    prices = { spotUsd, twapUsd };
  } catch (error) {
    prices = { unavailable: ponsRevertReason(error) ?? "Price unavailable." };
  }
  const [listed, maxLeverageBps, maintenanceMarginBps, maxPositionSize, maxOpenInterest, openInterest] = market;
  const positions = account ? await readPositions(client, account, token) : [];
  const usdgBalance = account
    ? await client.readContract({ address: env.USDG_ADDRESS as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] })
    : 0n;
  return {
    listed,
    maxLeverageBps,
    maintenanceMarginBps,
    maxPositionSize,
    maxOpenInterest,
    openInterest,
    openingPaused,
    feeBps,
    minHoldTime,
    freeAssets,
    prices,
    positions,
    usdgBalance,
  };
}
export type PonsMarketSnapshot = Awaited<ReturnType<typeof readPonsMarket>>;

async function readPositions(client: PublicClient, account: Address, token: Address) {
  const d = ponsDeployment!;
  const ids = await client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "positionsOf", args: [account] });
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [trader, asset, isLong, openedAt, collateral, size, entryPrice] = await client.readContract({
        address: d.manager,
        abi: ponsManagerAbi,
        functionName: "positions",
        args: [id],
      });
      let preview: { pnl: bigint; equity: bigint; liquidatable: boolean } | null = null;
      try {
        const [pnl, equity, liquidatable] = await client.readContract({ address: d.manager, abi: ponsManagerAbi, functionName: "previewPosition", args: [id] });
        preview = { pnl, equity, liquidatable };
      } catch {}
      return { id, trader, asset, isLong, openedAt, collateral, size, entryPrice, preview };
    }),
  );
  return rows.filter((p) => p.asset.toLowerCase() === token.toLowerCase());
}

/** Opening fee and resulting position size for a collateral amount, mirroring the contract. */
export function previewOpen(collateral: bigint, leverageBps: bigint, feeBps: bigint) {
  const fee = (((collateral * leverageBps) / BPS) * feeBps) / BPS;
  const net = collateral - fee;
  return { fee, net, size: (net * leverageBps) / BPS };
}

async function send(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  request: Parameters<PublicClient["simulateContract"]>[0],
  onSubmitted: (hash: Hex) => void,
) {
  const { request: simulated } = await client.simulateContract({ ...request, account });
  const gas = await client.estimateContractGas({ ...request, account } as Parameters<PublicClient["estimateContractGas"]>[0]);
  await ensureGasBalance(client, account, gas);
  const hash = await wallet.writeContract({ ...simulated, gas: (gas * 13n) / 10n } as Parameters<WalletClient["writeContract"]>[0]);
  onSubmitted(hash);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: env.LENDING_RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new Error("TRANSACTION_REVERTED");
  return hash;
}

async function ensureAllowance(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  spender: Address,
  amount: bigint,
  onSubmitted: (hash: Hex, label: string) => void,
) {
  const usdg = env.USDG_ADDRESS as Address;
  const allowance = await client.readContract({ address: usdg, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
  if (allowance >= amount) return;
  await send(client, wallet, account, { address: usdg, abi: erc20Abi, functionName: "approve", args: [spender, amount] }, (h) =>
    onSubmitted(h, "USDG approval"),
  );
}

export async function openPonsPosition(options: {
  client: PublicClient;
  wallet: WalletClient;
  account: Address;
  token: Address;
  isLong: boolean;
  collateral: bigint;
  leverageBps: bigint;
  onSubmitted: (hash: Hex, label: string) => void;
}) {
  const { client, wallet, account, onSubmitted } = options;
  const manager = ponsDeployment!.manager;
  await ensureAllowance(client, wallet, account, manager, options.collateral, onSubmitted);
  return send(
    client,
    wallet,
    account,
    {
      address: manager,
      abi: ponsManagerAbi,
      functionName: "openPosition",
      args: [options.token, options.isLong, options.collateral, options.leverageBps],
    },
    (h) => onSubmitted(h, "Open position"),
  );
}

export async function closePonsPosition(options: {
  client: PublicClient;
  wallet: WalletClient;
  account: Address;
  id: bigint;
  onSubmitted: (hash: Hex, label: string) => void;
}) {
  return send(
    options.client,
    options.wallet,
    options.account,
    { address: ponsDeployment!.manager, abi: ponsManagerAbi, functionName: "closePosition", args: [options.id] },
    (h) => options.onSubmitted(h, "Close position"),
  );
}

export async function readPonsVault(client: PublicClient, account?: Address) {
  const vault = ponsDeployment!.vault;
  const read = <T,>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address: vault, abi: ponsVaultAbi, functionName, args } as never) as Promise<T>;
  const [totalAssets, reserved, freeAssets, depositsPaused] = await Promise.all([
    read<bigint>("totalAssets"),
    read<bigint>("reserved"),
    read<bigint>("freeAssets"),
    read<boolean>("depositsPaused"),
  ]);
  let shares = 0n,
    position = 0n,
    maxWithdraw = 0n,
    usdgBalance = 0n;
  if (account) {
    shares = await read<bigint>("balanceOf", [account]);
    [position, maxWithdraw, usdgBalance] = await Promise.all([
      read<bigint>("convertToAssets", [shares]),
      read<bigint>("maxWithdraw", [account]),
      client.readContract({ address: env.USDG_ADDRESS as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    ]);
  }
  return { totalAssets, reserved, freeAssets, depositsPaused, shares, position, maxWithdraw, usdgBalance };
}

export async function ponsVaultAction(options: {
  client: PublicClient;
  wallet: WalletClient;
  account: Address;
  action: "deposit" | "withdraw";
  amount: bigint;
  onSubmitted: (hash: Hex, label: string) => void;
}) {
  const { client, wallet, account, amount, onSubmitted } = options;
  const vault = ponsDeployment!.vault;
  if (options.action === "deposit") {
    await ensureAllowance(client, wallet, account, vault, amount, onSubmitted);
    return send(client, wallet, account, { address: vault, abi: ponsVaultAbi, functionName: "deposit", args: [amount, account] }, (h) =>
      onSubmitted(h, "LP deposit"),
    );
  }
  return send(client, wallet, account, { address: vault, abi: ponsVaultAbi, functionName: "withdraw", args: [amount, account, account] }, (h) =>
    onSubmitted(h, "LP withdrawal"),
  );
}
