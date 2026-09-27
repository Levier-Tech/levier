export type LendingRiskInput = {
  collateral: bigint;
  debt: bigint;
  collateralBalance: bigint;
  debtBalance: bigint;
  liquidity: bigint;
  totalCollateral: bigint;
  totalDebt: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
  maxLtvBps: bigint;
  liquidationLtvBps: bigint;
  collateralDecimals: number;
  debtDecimals: number;
  collateralPrice: bigint | null;
  debtPrice: bigint | null;
  status: number;
};
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));
const positive = (x: bigint) => (x > 0n ? x : 0n);
const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function lendingRisk(input: LendingRiskInput) {
  const p = input;
  const depositMax =
    p.status === 2
      ? 0n
      : min(
          p.collateralBalance,
          p.supplyCap === 0n
            ? p.collateralBalance
            : positive(p.supplyCap - p.totalCollateral),
        );
  const repayMax = min(p.debt, p.debtBalance);
  if (p.collateralPrice === null || p.debtPrice === null)
    return {
      depositMax,
      repayMax,
      borrowMax: null,
      withdrawMax: p.debt === 0n ? p.collateral : null,
      collateralUsd: null,
      debtUsd: null,
      healthFactorBps: null,
      maxLtvBps: p.maxLtvBps,
      liquidationLtvBps: p.liquidationLtvBps,
    };
  const collateralUnit = 10n ** BigInt(p.collateralDecimals),
    debtUnit = 10n ** BigInt(p.debtDecimals);
  const collateralUsd = (p.collateral * p.collateralPrice) / collateralUnit;
  const debtUsd = ceil(p.debt * p.debtPrice, debtUnit);
  const maxDebtUsd = (collateralUsd * p.maxLtvBps) / 10000n;
  const borrowCapacity = positive(
    (maxDebtUsd * debtUnit) / p.debtPrice - p.debt,
  );
  const borrowMax =
    p.status !== 0
      ? 0n
      : min(
          borrowCapacity,
          p.liquidity,
          p.borrowCap === 0n
            ? borrowCapacity
            : positive(p.borrowCap - p.totalDebt),
        );
  const minimumCollateral =
    p.debt === 0n
      ? 0n
      : p.maxLtvBps === 0n
        ? p.collateral
        : ceil(
            ceil(debtUsd * 10000n, p.maxLtvBps) * collateralUnit,
            p.collateralPrice,
          );
  return {
    depositMax,
    repayMax,
    borrowMax,
    withdrawMax: positive(p.collateral - minimumCollateral),
    collateralUsd,
    debtUsd,
    healthFactorBps:
      p.debt === 0n
        ? null
        : (((collateralUsd * p.liquidationLtvBps) / 10000n) * 10000n) / debtUsd,
    maxLtvBps: p.maxLtvBps,
    liquidationLtvBps: p.liquidationLtvBps,
  };
}
