import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { join, relative } from "node:path";
const root = process.cwd();
const values = new Set();
const browserValues = new Set();
function envFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      [
        "node_modules",
        ".git",
        ".next",
        "out",
        "cache",
        "lib",
        "dist",
        ".turbo",
      ].includes(entry.name)
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) envFiles(path);
    else if (
      /^\.env(?:\.|$)/.test(entry.name) &&
      !entry.name.endsWith(".example")
    ) {
      for (const [key, value] of Object.entries(
        parseEnv(readFileSync(path, "utf8")),
      )) {
        if (
          value.length >= 12 &&
          !/^(?:0x)?0+$/.test(value) &&
          /PRIVATE_KEY|SECRET|PASSWORD|API_KEY|ANON_KEY|SERVICE_ROLE|RPC_URL|SUPABASE_URL|DATABASE_URL/.test(
            key,
          )
        )
          values.add(value);
        if (
          value.length >= 12 &&
          /API_KEY|RPC_URL|BACKEND_API_URL|SUPABASE|DATABASE_URL/.test(key)
        )
          browserValues.add(value);
      }
    }
  }
}
envFiles(root);
const violations = [];
function inspect(path, secrets) {
  if (!existsSync(path) || !statSync(path).isFile()) return;
  const text = readFileSync(path).toString("utf8");
  if (
    [...secrets].some((value) => text.includes(value)) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /(?:privateKey|PRIVATE_KEY)\s*[:=]\s*["']0x(?!0{64}["'])[0-9a-fA-F]{64}["']/.test(
      text,
    )
  )
    violations.push(relative(root, path));
}
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (const file of files) inspect(join(root, file), values);
// Local development tooling/evidence can be ignored by Git and still needs scanning.
let extraFiles = 0;
function inspectLocalSources(directory) {
  if (!existsSync(directory)) return;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (
      item.name.startsWith(".") ||
      ["node_modules", "out", "cache", "dist"].includes(item.name)
    )
      continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) inspectLocalSources(path);
    else if (/\.(?:mjs|cjs|js|ts|tsx|json|md)$/.test(item.name)) {
      inspect(path, values);
      extraFiles++;
    }
  }
}
for (const directory of ["scripts", "docs", "tests"])
  inspectLocalSources(join(root, directory));

function inspectBundle(directory) {
  if (!existsSync(directory)) return;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) inspectBundle(path);
    else inspect(path, new Set([...values, ...browserValues]));
  }
}
if (process.argv.includes("--client-build")) {
  const clientDirectory = join(root, "apps/web/.next/static");
  if (
    !existsSync(clientDirectory) ||
    !existsSync(join(root, "apps/web/.next/BUILD_ID"))
  ) {
    console.error(
      "A completed production web build is required for the client asset check.",
    );
    process.exit(1);
  }
  inspectBundle(clientDirectory);
}
if (violations.length) {
  console.error("Sensitive values detected in files (values redacted):");
  console.error([...new Set(violations)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Secret check PASS: ${files.length} worktree paths, ${extraFiles} local tooling/evidence files${process.argv.includes("--client-build") ? " and generated client assets" : ""}; values redacted`,
  );
