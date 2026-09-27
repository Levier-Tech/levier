import { spawn } from "node:child_process";

const SERVICES = [
  {
    name: "API",
    command: "pnpm",
    args: ["--filter=@levier/api", "start"],
    color: "\x1b[36m", // Cyan
  },
  {
    name: "INDEXER",
    command: "pnpm",
    args: ["--filter=@levier/indexer", "start"],
    color: "\x1b[35m", // Magenta
  },
  {
    name: "ORACLE",
    command: "pnpm",
    args: ["--filter=@levier/price-oracle", "start"],
    color: "\x1b[33m", // Yellow
  },
  {
    name: "KEEPER",
    command: "pnpm",
    args: ["--filter=@levier/keeper", "start"],
    color: "\x1b[32m", // Green
  },
];

const RESET = "\x1b[0m";
const children = new Map();

function startProcess(service) {
  const prefix = `${service.color}[${service.name}]${RESET}`;
  console.log(`${prefix} Starting daemon...`);

  const child = spawn(service.command, service.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  children.set(service.name, child);

  child.stdout?.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.log(`${prefix} ${line}`);
      }
    }
  });

  child.stderr?.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        console.error(`${prefix} ${line}`);
      }
    }
  });

  child.on("exit", (code, signal) => {
    children.delete(service.name);
    console.warn(
      `${prefix} Exited with code=${code} signal=${signal}. Restarting in 5s...`
    );
    if (!isShuttingDown) {
      setTimeout(() => startProcess(service), 5000);
    }
  });

  child.on("error", (err) => {
    console.error(`${prefix} Failed to spawn: ${err.message}`);
  });
}

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[BACKEND-MANAGER] Received ${signal}. Gracefully stopping all services...`);
  for (const [name, child] of children.entries()) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    console.log("[BACKEND-MANAGER] Shutdown complete.");
    process.exit(0);
  }, 2000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("===============================================================");
console.log("      LEVIER PROTOCOL — ALL-IN-ONE BACKEND ORCHESTRATOR        ");
console.log("===============================================================");
console.log(`Active Services: ${SERVICES.map((s) => s.name).join(", ")}`);
console.log("===============================================================\n");

for (const service of SERVICES) {
  startProcess(service);
}
