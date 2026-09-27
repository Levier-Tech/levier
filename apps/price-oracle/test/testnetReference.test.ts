import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUsdgBook } from "../src/services/testnetReference.js";
const now = Date.parse("2026-09-17T04:00:00Z");
const policy = { maxAgeMs: 600000, maxFutureSkewMs: 0, maxSpreadBps: 50 };
const book = () => ({
  error: [],
  result: {
    symbol: "USDG/USD",
    base_asset: "USDG",
    quote_asset: "USD",
    bids: [
      { price: "0.9999", qty: "50", publication_ts: "2026-09-17T03:59:10Z" },
    ],
    asks: [
      { price: "1.0001", qty: "50", publication_ts: "2026-09-17T03:59:20Z" },
    ],
  },
});
test("USDG uses executable ask and the older source timestamp, without a peg fallback", () => {
  const result = validateUsdgBook(book(), policy, now);
  assert.equal(result.price18, "1000100000000000000");
  assert.equal(
    result.sourceTimestamp,
    Date.parse("2026-09-17T03:59:10Z") / 1000,
  );
});
test("USDG rejects stale or future levels even if retrieved now", () => {
  for (const timestamp of ["2026-09-17T03:49:59Z", "2026-09-17T04:00:01Z"]) {
    const b = book();
    b.result.asks[0].publication_ts = timestamp;
    assert.throws(() => validateUsdgBook(b, policy, now), /STALE_USDG_SOURCE/);
  }
});
test("USDG rejects wrong identity, empty or invalid books and upstream errors", () => {
  const wrong = book();
  wrong.result.base_asset = "USDT";
  const empty = book();
  empty.result.bids = [];
  const crossed = book();
  crossed.result.asks[0].price = "0.9";
  const wide = book();
  wide.result.asks[0].price = "1.05";
  const zero = book();
  zero.result.asks[0].qty = "0";
  for (const b of [
    wrong,
    empty,
    crossed,
    wide,
    zero,
    { error: ["Unavailable"] },
  ])
    assert.throws(() => validateUsdgBook(b, policy, now));
});
