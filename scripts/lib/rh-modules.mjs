import { artifact, assert, same, verifyRuntime, v } from "./rh-live.mjs";

export function parseModulesConfig(value) {
  assert(
    typeof value === "string" && value.length > 0,
    "RH_MODULES_CONFIG_REQUIRED",
  );
  let c;
  try {
    c = JSON.parse(value);
  } catch {
    throw Error("INVALID_MODULES_JSON");
  }
  const keys = [
    "registry",
    "registryCodeHash",
    "lendingRouter",
    "lendingRouterCodeHash",
    "debt",
    "debtCodeHash",
    "vaultName",
    "vaultSymbol",
    "vaultSlug",
    "vaultRiskTier",
  ];
  assert(
    c &&
      typeof c === "object" &&
      Object.keys(c).length === keys.length &&
      keys.every((k) => Object.hasOwn(c, k)),
    "INVALID_MODULES_FIELDS",
  );
  for (const k of ["registry", "lendingRouter", "debt"])
    assert(
      v.isAddress(c[k]) && !same(c[k], v.zeroAddress),
      "INVALID_MODULES_ADDRESS",
    );
  for (const k of ["registryCodeHash", "lendingRouterCodeHash", "debtCodeHash"])
    assert(
      /^0x[0-9a-fA-F]{64}$/.test(c[k]) && BigInt(c[k]) !== 0n,
      "INVALID_MODULES_CODE_HASH",
    );
  for (const k of ["vaultName", "vaultSymbol", "vaultSlug", "vaultRiskTier"])
    assert(
      typeof c[k] === "string" && /^[A-Za-z0-9 _-]{1,80}$/.test(c[k]),
      "INVALID_VAULT_METADATA",
    );
  return c;
}
export function moduleSpecs(c, owner) {
  return [
    { role: "leverageRouter", contract: "LeverageRouter", args: [owner] },
    { role: "shortRouter", contract: "ShortRouter", args: [owner] },
    { role: "autoProtect", contract: "AutoProtectModule", args: [owner] },
    {
      role: "levierVault",
      contract: "LevierVault",
      args: [
        c.debt,
        c.vaultName,
        c.vaultSymbol,
        c.vaultSlug,
        c.vaultRiskTier,
        owner,
      ],
    },
  ];
}
export async function verifyModuleInputs(ctx, c) {
  assert(
    ctx.env.LENDING_ENABLED === "false",
    "DISABLE_LENDING_BEFORE_MODULE_DEPLOYMENT",
  );
  const addresses = JSON.parse(ctx.env.PROTOCOL_ADDRESSES);
  assert(
    same(c.registry, ctx.state.registry) &&
      same(c.lendingRouter, ctx.state.router) &&
      same(c.registry, addresses.registry) &&
      same(c.lendingRouter, addresses.levierRouter),
    "BASE_MANIFEST_MISMATCH",
  );
  assert(
    same(c.debt, ctx.env.USDG_ADDRESS) &&
      same(c.debt, ctx.env.USDG_ISSUER_TESTNET_ADDRESS) &&
      same(c.debt, addresses.tokens.USDG),
    "ISSUER_TOKEN_MISMATCH",
  );
  assert(
    same(
      await verifyRuntime(ctx.client, c.registry, "LevierMarketRegistry"),
      c.registryCodeHash,
    ) &&
      same(
        await verifyRuntime(ctx.client, c.lendingRouter, "LevierRouter"),
        c.lendingRouterCodeHash,
      ),
    "BASE_RUNTIME_MISMATCH",
  );
  const code = await ctx.client.getCode({ address: c.debt });
  assert(
    code && same(v.keccak256(code), c.debtCodeHash),
    "DEBT_RUNTIME_MISMATCH",
  );
  const read = (address, abi, functionName, args = []) =>
    ctx.client.readContract({ address, abi, functionName, args });
  const registry = artifact("LevierMarketRegistry").abi;
  assert(
    same(await read(c.registry, registry, "owner"), ctx.deployer.address),
    "REGISTRY_OWNER_MISMATCH",
  );
  assert(
    await read(c.registry, registry, "isAuthorizedRouter", [c.lendingRouter]),
    "LENDING_ROUTER_UNAUTHORIZED",
  );
  assert(
    (await read(c.debt, v.erc20Abi, "symbol")) === "USDG" &&
      (await read(c.debt, v.erc20Abi, "decimals")) === 6,
    "DEBT_METADATA_MISMATCH",
  );
}
export async function verifyModule(ctx, c, spec, address) {
  const codeHash = await verifyRuntime(ctx.client, address, spec.contract);
  const read = (name, args = []) =>
    ctx.client.readContract({
      address,
      abi: artifact(spec.contract).abi,
      functionName: name,
      args,
    });
  assert(
    same(await read("owner"), ctx.deployer.address),
    "MODULE_OWNER_MISMATCH",
  );
  if (spec.role === "levierVault") {
    assert(
      same(await read("asset"), c.debt) && (await read("depositsPaused")),
      "VAULT_CONFIGURATION_MISMATCH",
    );
    for (const name of ["totalSupply", "totalAssets", "getAllocationsCount"])
      assert((await read(name)) === 0n, "VAULT_MUST_START_EMPTY");
    for (const name of ["maxDeposit", "maxMint"])
      assert(
        (await read(name, [ctx.deployer.address])) === 0n,
        "VAULT_MUST_START_CLOSED",
      );
  } else assert(await read("isPaused"), "MODULE_MUST_START_PAUSED");
  if (spec.role === "leverageRouter" || spec.role === "shortRouter")
    assert(
      !(await ctx.client.readContract({
        address: c.registry,
        abi: artifact("LevierMarketRegistry").abi,
        functionName: "isAuthorizedRouter",
        args: [address],
      })),
      "INCOMPLETE_ROUTER_MUST_NOT_BE_AUTHORIZED",
    );
  return codeHash;
}
