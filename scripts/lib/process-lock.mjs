import {
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
export function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch {
    throw Error("LIVE_PROCESS_LOCKED_RECONCILE_BEFORE_RESTART");
  }
  writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );
  // A stale lock is intentionally not deleted automatically; pending sends must be reconciled.
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      closeSync(fd);
      unlinkSync(path);
    }
  };
  process.once("exit", release);
  return release;
}
