import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crc32,
  decodeBookMessage,
  validateUsdgSnapshot,
} from "../src/services/krakenBookService.js";
const now = Date.parse("2026-09-17T06:16:50Z");
const policy = { maxAgeMs: 60000, maxFutureSkewMs: 0, maxSpreadBps: 50 };
// Public exchange snapshot captured before deployment; decimal lexemes are checksum-significant.
const wire =
  '{"channel":"book","type":"snapshot","data":[{"symbol":"USDG/USD","bids":[{"price":0.9999,"qty":653645.22211},{"price":0.9998,"qty":21389.49905},{"price":0.9997,"qty":311181.88799},{"price":0.9996,"qty":935949.00167},{"price":0.9995,"qty":5.25262},{"price":0.9993,"qty":15819.07585},{"price":0.9990,"qty":28045.34609},{"price":0.9985,"qty":35372.52894},{"price":0.9900,"qty":10.07905},{"price":0.9835,"qty":240.14072}],"asks":[{"price":1.0000,"qty":382506.65119},{"price":1.0001,"qty":242215.90771},{"price":1.0002,"qty":357570.43200},{"price":1.0003,"qty":936797.08901},{"price":1.0004,"qty":10578.85361},{"price":1.0005,"qty":83656.47123},{"price":1.0007,"qty":15819.07585},{"price":1.0010,"qty":23655.03579},{"price":1.0015,"qty":35372.52894},{"price":1.0024,"qty":5000.00000}],"checksum":3225719247,"timestamp":"2026-09-17T06:16:44.386754Z"}]}';
test("CRC32 matches standard vector and observed exchange snapshot", () => {
  assert.equal(crc32("123456789"), 0xcbf43926);
  const result = validateUsdgSnapshot(decodeBookMessage(wire), policy, now);
  assert.equal(result.ask, "1.0000");
  assert.equal(result.checksum, 3225719247);
  assert.equal(result.price18, "1000000000000000000");
  assert.equal(
    result.sourceTimestamp,
    Math.floor(Date.parse("2026-09-17T06:16:44.386754Z") / 1000),
  );
});
test("floating-point parsing, tampering and deltas cannot masquerade as a verified snapshot", () => {
  assert.throws(() => validateUsdgSnapshot(JSON.parse(wire), policy, now));
  assert.throws(
    () =>
      validateUsdgSnapshot(
        decodeBookMessage(wire.replace("382506.65119", "382506.65118")),
        policy,
        now,
      ),
    /CHECKSUM/,
  );
  assert.throws(
    () =>
      validateUsdgSnapshot(
        decodeBookMessage(wire.replace("snapshot", "update")),
        policy,
        now,
      ),
    /INVALID_USDG_SNAPSHOT/,
  );
});
test("old/future snapshots and wrong market identity are rejected", () => {
  assert.throws(
    () => validateUsdgSnapshot(decodeBookMessage(wire), policy, now + 60000),
    /STALE_USDG_SOURCE/,
  );
  assert.throws(
    () => validateUsdgSnapshot(decodeBookMessage(wire), policy, now - 10000),
    /FUTURE_USDG_SOURCE/,
  );
  assert.throws(() =>
    validateUsdgSnapshot(
      decodeBookMessage(wire.replace("USDG/USD", "USDT/USD")),
      policy,
      now,
    ),
  );
});
