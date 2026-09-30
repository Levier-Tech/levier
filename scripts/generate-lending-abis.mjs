import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const groups = {
  margin: ["MarginRouter", "RhShortReferenceOracle"],
  lending: [
    "LevierPair",
    "LevierRouter",
    "LevierMarketRegistry",
    "VerifiedFeedOracle",
  ],
  modules: [
    "LeverageRouter",
    "ShortRouter",
    "AutoProtectModule",
    "LevierVault",
    "RhTestnetReferenceOracle",
  ],
};
for (const [group, names] of Object.entries(groups)) {
  const output = new URL(`apps/web/src/contracts/generated/${group}.ts`, root);
  let source =
    "// Generated from Foundry artifacts by scripts/generate-lending-abis.mjs. Do not edit.\n";
  for (const name of names) {
    const artifact = JSON.parse(
      readFileSync(
        new URL(`packages/contracts/out/${name}.sol/${name}.json`, root),
        "utf8",
      ),
    );
    if (!Array.isArray(artifact.abi)) throw Error("Missing compiled ABI");
    source += `export const ${name}ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
  }
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== source)
      throw Error(`Generated ${group} ABIs differ from compiled contracts`);
    console.log(`Generated ${group} ABIs match compiled contracts.`);
  } else {
    mkdirSync(fileURLToPath(new URL(".", output)), { recursive: true });
    writeFileSync(output, source);
    console.log(`Generated ${group} ABIs without deployment addresses.`);
  }
}
