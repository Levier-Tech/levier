const check = (value, code) => {
  if (!value) throw Error(code);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export function receiptGasSettlement(
  operation,
  receipt,
  canonicalHash,
  head,
  confirmations,
) {
  check(
    Number.isSafeInteger(confirmations) && confirmations > 0,
    "INVALID_GAS_CONFIRMATIONS",
  );
  check(
    receipt &&
      same(receipt.transactionHash, operation.hash) &&
      same(receipt.from, operation.from) &&
      same(receipt.to ?? "", operation.to ?? ""),
    "GAS_RECEIPT_IDENTITY_MISMATCH",
  );
  check(
    ["success", "reverted"].includes(receipt.status) &&
      same(receipt.blockHash, canonicalHash),
    "GAS_RECEIPT_NOT_CANONICAL",
  );
  check(
    BigInt(head) >= BigInt(receipt.blockNumber) + BigInt(confirmations) - 1n,
    "GAS_RECEIPT_UNCONFIRMED",
  );
  const used = BigInt(receipt.gasUsed),
    price = BigInt(receipt.effectiveGasPrice),
    reserved = BigInt(operation.reservedGasCostWei);
  check(used > 0n && price > 0n && reserved > 0n, "INVALID_GAS_RECEIPT_COST");
  // RH is Nitro: parent-chain gas is already included in gasUsed, not added again.
  if (receipt.gasUsedForL1 !== undefined)
    check(
      BigInt(receipt.gasUsedForL1) >= 0n &&
        BigInt(receipt.gasUsedForL1) <= used,
      "INVALID_PARENT_GAS",
    );
  check(
    receipt.l1Fee === undefined || BigInt(receipt.l1Fee) === 0n,
    "SEPARATE_PARENT_FEE_UNSUPPORTED",
  );
  const cost = used * price;
  check(cost <= reserved, "RECEIPT_EXCEEDS_GAS_RESERVATION");
  return {
    costWei: String(cost),
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: String(receipt.blockNumber),
    confirmations,
  };
}
export function chargedGasCost(operation) {
  const reserved = BigInt(operation.reservedGasCostWei);
  check(reserved > 0n, "INVALID_GAS_RESERVATION");
  if (!operation.gasSettlement) return reserved;
  const s = operation.gasSettlement,
    r = operation.receipt;
  const verified = receiptGasSettlement(
    operation,
    r,
    s.blockHash,
    BigInt(s.blockNumber) + BigInt(s.confirmations) - 1n,
    s.confirmations,
  );
  check(
    same(s.transactionHash, verified.transactionHash) &&
      s.blockNumber === verified.blockNumber &&
      s.costWei === verified.costWei,
    "GAS_SETTLEMENT_MISMATCH",
  );
  return BigInt(s.costWei);
}
export async function verifyGasLedgerAnchor(ctx) {
  const settled = Object.values(ctx.state.operations).some(
    (x) => x.gasSettlement,
  );
  if (!settled) return;
  const anchor = ctx.state.gasLedgerAnchor;
  check(anchor, "GAS_LEDGER_ANCHOR_REQUIRED");
  const block = await ctx.client.getBlock({
    blockNumber: BigInt(anchor.blockNumber),
  });
  check(
    same(block.hash, anchor.blockHash),
    "GAS_LEDGER_REORG_RECONCILE_REQUIRED",
  );
}
export async function settleOperationGas(
  ctx,
  operation,
  receipt,
  confirmations,
) {
  await verifyGasLedgerAnchor(ctx);
  const head = await ctx.client.getBlock();
  const block = await ctx.client.getBlock({ blockNumber: receipt.blockNumber });
  operation.gasSettlement = receiptGasSettlement(
    operation,
    receipt,
    block.hash,
    head.number,
    confirmations,
  );
  ctx.state.gasLedgerAnchor = {
    blockNumber: String(head.number),
    blockHash: head.hash,
  };
}
