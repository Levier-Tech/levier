---
id: rebranding-development-plan
aliases: []
tags: []
---

# Rebranding Development Plan — LEVERA → Levier

> How to rename the inherited LEVERA Markets codebase to "Levier", file by
> file, in reviewable phases. This document plans the work; it does not
> execute any renames itself.

## 1. Objective & Scope

Rename every occurrence of the brand **"LEVERA" / "Levera"** to **"Levier"**
across code, config, docs, and data — wherever it names the product,
company, packages, contracts, or UI copy.

**Not in scope**: generic finance vocabulary that happens to contain
"lever" — `leverage`, `max_leverage`, `deleverage`, `LeverageRouter`'s
_function_, etc. Only the brand name changes, not the English word.

## 2. Non-Goals

- No redeploy of on-chain contracts in this pass. Source-level Solidity
  renames (Phase 6) do not touch the already-deployed RH Testnet bytecode.
- No change to the external, already-launched Pons memecoin token named
  "Levera Markets" (symbol `LEVERA`) — that is someone else's on-chain
  asset, not our branding to rename.
- No touching vendored third-party code (`packages/contracts/lib/forge-std`).

## 3. Phased Rollout

Sixteen small phases instead of eight big ones — each is one PR-sized,
independently reviewable unit. Design rules behind the split:

1. **Atomicity boundary**: only split a phase further if each piece can
   compile/lint green on its own. Package renames and contract renames
   each land as one internal commit (can't half-rename and still build).
2. **Disjoint-file phases are parallel-safe** — called out explicitly
   below so separate branches can run at the same time without conflicts.
3. **Shared-file phases stay together** — anything touching root
   `package.json`, `Dockerfile`, `turbo.json`, `nixpacks.toml` is one
   phase, not split across PRs, so two branches don't fight over the same
   few lines.
4. **UI phases split by directory** — shared shell (Header/Footer/layout)
   goes first and alone, so page-level phases don't also touch it.

### Phase 1 — Docs & Prose (zero risk) — Status: DONE

- `README.md` — title, badges, prose throughout.
- Any other root-level `.md` files.
- `docs/project-specs.md` already written under the "Levier" name — no
  change needed.

### Phase 2 — `packages/types` Rename (leaf package) — Status: DONE

- `@levera/types` → `@levier/types` in `packages/types/package.json`.
- Every consumer's `workspace:*` entry and `@levera/types` import string,
  updated in the same commit (mechanical, but isolated to one package's
  identity — a leaf with no internal deps of its own).

### Phase 3 — `packages/contracts` Package Identity Only — Status: DONE

- `@levera/contracts` → `@levier/contracts` in
  `packages/contracts/package.json`.
- Kept separate from the Solidity source rename (Phase 13) — package
  identity and contract identifiers are independent risks.

### Phase 4 — Remaining App Package Identities (one atomic phase) — Status: DONE

- `package.json` name fields: `apps/web`, `apps/api`, `apps/indexer`,
  `apps/keeper`, `apps/price-oracle` → `@levier/*`.
- Every `--filter=@levera/...` reference in root `package.json` scripts
  (`build`, `build:backend`, `dev`, `dev:core`, the `rh:*`/`pons:*`
  scripts), `turbo.json`, `nixpacks.toml`
  (`pnpm --filter=@levera/${SERVICE:-web} start`), `Dockerfile`
  (`pnpm --filter=@levera/${SERVICE} build` and `... start`).
- Run `pnpm install` afterward to regenerate `pnpm-lock.yaml` — never
  hand-edit the lockfile.
- Kept as one phase: these all touch the same few shared files, so
  splitting further would just create conflicting PRs on `Dockerfile` /
  root `package.json`.

### Phase 5 — Root Env Example Files — Status: DONE

- `.env.example`, `.env.mainnet.example`, `.env.mainnet.core.example`,
  `.env.testnet.example` — comments/default display values, not variable
  names. Current var names (`RH_*`, `USDG_*`, `PONS_*`, `NETWORK_MODE`,
  `CHAIN_ID`) are already generic — confirm none literally spell the brand
  before skipping a rename.

### Phase 6 — Per-App Env Example Files — Status: DONE

_Parallel-safe with Phase 5_ — disjoint files, can even be one PR per app.

- `apps/api/.env.example`, `apps/keeper/.env.example`,
  `apps/web/.env.mainnet.example`, `apps/web/.env.testnet.example`.

### Phase 7 — Web Config Files — Status: DONE (nothing to change)

- `apps/web/config/environment.cjs`, `apps/web/config/margin.cjs`,
  `apps/web/next.config.js` — comments/default display strings.

### Phase 8 — Frontend Shared Shell Copy — Status: DONE

Do this **before** page-level phases so they don't also touch these files.

- `Header.tsx`, `Footer.tsx`, `HeroSection.tsx`, `FAQSection.tsx`,
  `HowItWorks.tsx`, `ComparisonMatrix.tsx`, `layout.tsx` (meta/title).

### Phase 9a — Core Product Pages/Components — Status: DONE

- Markets, trade, earn, portfolio, analytics routes and their components
  under `apps/web/src/app/` and `apps/web/src/components/` (excluding
  China/Pons directories, covered separately below).

### Phase 9b — China Market Components/Pages — Status: DONE

_Parallel-safe with 9a and 9c_ — own directory, no overlap.

- `apps/web/src/components/china/*`, `apps/web/src/app/markets/china/*`.

### Phase 9c — Pons Market Components/Pages — Status: DONE

_Parallel-safe with 9a and 9b_ — own directory, no overlap.

- `apps/web/src/app/markets/pons`, `apps/web/src/app/api/{markets,pons}/pons`
  routes, `usePonsMarkets.ts` brand strings.

### Phase 10 — Frontend Hook Renames — Status: DONE

Done **after** Phase 8/9a/9b/9c so it isn't re-touching files those phases
already edited.

- `useLeveraMarkets.ts` → `useLevierMarkets.ts`,
  `useLeveraPortfolio.ts` → `useLevierPortfolio.ts`,
  `useLeveraVault.ts` → `useLevierVault.ts` — rename file + symbol + every
  call site.
- `apps/web/src/app/globals.css` — check for brand-named CSS custom
  properties/classes.

### Phase 10.5 — Frontend Restyle (Full Visual Redesign) — Status: DONE

**Out of the brand-rename scope in §1** — this is a separate visual-design
initiative, not a "LEVERA" → "Levier" text swap. Included here only for
sequencing, since it touches the same files as Phases 8–10.

- Whole `apps/web` UI — layout, components, pages, `globals.css`, design
  tokens/theme. Full restyle, not enumerated file-by-file.
- **Strictly after Phase 8 → 9a/9b/9c → 10** — starts from an already-
  `Levier`-named codebase, avoids two initiatives editing the same JSX in
  overlapping PRs.
- Parallel-safe with Phase 11 (backend) — zero file overlap with
  `apps/api`/`apps/keeper`.

### Phase 11 — Backend Service Copy — Status: DONE

_Parallel-safe with all of Phase 8–10_ — zero file overlap with frontend.

- `apps/api/src/index.ts` + `apps/api/src/routes/{activity,autoProtect,
markets,portfolio,positions,vaults}.ts`.
- `apps/keeper/src/client.ts`, `src/index.ts`,
  `src/services/{executionService,positionMonitor}.ts`.

### Phase 12 — Seed & Sample Data — Status: DONE

_Fully independent, can run any time_ — no code dependency on any other
phase.

- `supabase/seed.sql` — vault slugs `levera-usdg-vault-testnet`,
  `levera-usd-vault-testnet`, `levera-usdg-vault-mainnet` →
  `levier-usdg-vault-testnet`, etc.; display names `"Levera USDG Yield
Vault"` → `"Levier USDG Yield Vault"` (and USDC counterpart). Data, not
  schema — re-running the seed script is enough, no migration needed.
- `data/markets.json`, `data/vaults.json`,
  `data/chinese-equities-markets.json`, `data/chinese-equities-proofs.json`
  — any brand display-name fields.

### Phase 13 — Smart Contract Source Rename (one atomic PR, highest risk) — Status: DONE

**Gap-fill beyond this section's original file list**, found by direct grep
during execution, not the original survey — fixed in the same commit:

- `scripts/run-all-backend.mjs` — `--filter=@levera/{api,indexer,price-oracle,
  keeper}` was missed by Phase 4; now `@levier/*`. Banner string also fixed.
- `scripts/rh-live.mjs`, `scripts/finalize-rh-deployment.mjs`,
  `scripts/lib/rh-modules.mjs` — derived camelCase variable/property/role
  names (`leveraVault`, `leveraRouter`, `LEVERA_VAULT_ADDRESS`) that the
  type-identifier rename didn't touch since they're lowercase-first.
- `packages/contracts/script/DeployLevier.s.sol` (banner string + vault slug)
  and `test/LevierVault.t.sol`, `test/LevierCore.t.sol`,
  `test/LevierInvariants.t.sol` — `"levera-usdg-vault-*"` slug literals.
- `.env.mainnet.core.example` — `MAINNET_LEVERA_VAULT_ADDRESS` →
  `MAINNET_LEVIER_VAULT_ADDRESS`, per §8.2's own rename note.
- Actual root-level scripts hardcoding old contract names: **20 files**, not
  the 18 this section originally listed — also includes
  `scripts/check-rh-margin.mjs`, `scripts/check-rh-markets-ready.mjs`,
  `scripts/enable-rh-expansion.mjs`.
- Gate (13e) passed: `forge build` clean, `forge test` 124/124 passed, and
  the grep gate below returns nothing.

Compilation requires this to land as one unit, but sequence the work
inside it. **This phase is bigger than contract source alone** — a
repo-wide check found 18 root-level `scripts/*.mjs` deploy-orchestrator
files that hardcode the old contract names as Foundry artifact lookups or
generated-ABI import names. Renaming only `packages/contracts/src` and
leaving these untouched would break the testnet/mainnet deploy pipeline
immediately (Phase 13.5 and §8.2 both run these scripts).

- **13a.** Rename contract files/identifiers across
  `packages/contracts/src`: `LeveraPair.sol` → `LevierPair.sol`,
  `LeveraMarketRegistry.sol` → `LevierMarketRegistry.sol`,
  `LeveraRouter.sol` → `LevierRouter.sol`, `LeveraVault.sol` →
  `LevierVault.sol`, plus every file that references these types
  (`AutoProtectModule.sol`, `PonsAutoProtectModule.sol`, oracle contracts,
  Pons adapter/risk-engine contracts, `MarginRouter.sol`,
  `LeveragePositionManager.sol`) — one commit.
- **13b.** Update deploy scripts: `script/DeployLevera.s.sol` and any
  sibling script referencing the renamed contracts.
- **13c.** Update tests: `test/LeveraCore.t.sol`, `LeveraInvariants.t.sol`,
  `LeveraVault.t.sol`, and any other affected test file.
- **13d.** Update the root-level deploy-orchestrator scripts, in the same
  commit as 13a–13c (they resolve contract names at runtime, so a
  half-renamed workspace breaks them exactly like a half-renamed build):
  `scripts/generate-lending-abis.mjs` (its hardcoded `groups` name list —
  this drives ABI codegen for Phase 14, must change first),
  `scripts/rh-live.mjs`, `scripts/prepare-rh-suite.mjs`,
  `scripts/simulate-rh-modules.mjs`, `scripts/finalize-rh-deployment.mjs`,
  `scripts/deploy-rh-margin.mjs`, `scripts/accept-rh-margin.mjs`,
  `scripts/deploy-rh-expansion.mjs`, `scripts/accept-rh-expansion.mjs`,
  `scripts/plan-rh-expansion.mjs`, `scripts/pause-rh-markets.mjs`,
  `scripts/prepare-rh-mainnet-core.mjs`, `scripts/deploy-rh-mainnet-core.mjs`,
  `scripts/run-rh-publisher.mjs`, `scripts/verify-rh-indexer.mjs`,
  `scripts/verify-rh-wallet-cycle.mjs`, `scripts/lib/rh-indexer.mjs`,
  `scripts/lib/rh-modules.mjs`.
- **13e.** Gate: `forge build` + `forge test` must pass, **and**
  `grep -rn "LeveraPair\|LeveraRouter\|LeveraMarketRegistry\|LeveraVault"
scripts/ packages/contracts/src packages/contracts/script
packages/contracts/test` returns nothing before merging.
- **Explicitly**: this only changes source-level names. The already-
  deployed RH Testnet contracts keep their existing on-chain address and
  bytecode under the old name — `packages/contracts/deployments.json`,
  `deployments/testnet.json`, and `deployments/DEPLOYMENT_RECEIPT.md` stay
  as historical records of the legacy LEVERA testnet deployment unless a
  separate decision is made to redeploy fresh contracts under the new name
  (see Phase 13.5, next).

### Phase 13.5 — Testnet Redeploy & Lifecycle Verification — Status: DONE

Real-code gaps found and fixed during execution, beyond the doc's original
runbook (5-command list was incomplete — actual sequence needed a core
deploy + market/oracle deploy + funded acceptance lifecycle first):

- `apps/web/config/environment.cjs` — `protocolSchema` still required the
  old brand keys `leveraRouter`/`leveraVault` (Phase 7 rename gap, missed
  because these are JS object keys, not string literals a text-based
  rename would catch); renamed to `levierRouter`/`levierVault` to match
  what every deploy script actually writes.
- `scripts/finalize-rh-deployment.mjs` — never wrote `addresses.usdg` into
  `PROTOCOL_ADDRESSES`, but the (now-fixed) schema requires it; added.
- `.env.testnet` had several required-but-blank fields not covered by any
  doc checklist: `TESTER_ADDRESS`, `RH_PUBLISHER_POLICY_JSON`.
- New real testnet deployment recorded: `packages/contracts/deployments/
  testnet-46630.json` (new file, real chain 46630) + a new section
  appended to `DEPLOYMENT_RECEIPT.md` — legacy chain-31337 record
  untouched per §5.
- Gate passed: funded deposit → borrow → repay → withdraw lifecycle
  passed (`FUNDED_LENDING_LIFECYCLE_PASSED`), `finalize:rh-deployment`
  and `rh:lending:status` both clean.

Phase 13/14 only rename source and regenerate ABIs — after them, the new
`Levier*` contracts exist as code but are **deployed nowhere**. This phase
puts them on RH Testnet and proves parity with the already-passed
TSLA/USDG lifecycle before anyone touches mainnet.

- Run the existing testnet pipeline against the renamed contracts, in
  order: `pnpm prepare:rh-suite` → `pnpm simulate:rh-modules` →
  `pnpm deploy:rh-modules` → `pnpm finalize:rh-deployment` →
  `pnpm rh:lending:status`.
- Re-run the deposit → borrow → repay → withdraw lifecycle with real
  TSLA/USDG (same test the old-named contracts already passed per
  README) and confirm it still passes under `Levier*` contracts — parity
  with the original result is the gate.
- Record the new Levier testnet addresses in
  `packages/contracts/deployments/testnet.json` and
  `deployments/DEPLOYMENT_RECEIPT.md` as a **new** entry — the existing
  legacy-named entries stay untouched per §5.
- **Gate**: lifecycle passes exactly like the original testnet deployment
  did. Only after this phase passes does §8's Pre-Mainnet Checklist
  become reachable — deploying to mainnet before this phase would skip
  the one testnet proof that the rename didn't silently break anything.

### Phase 13.6 — Remaining Contract Deployment — Status: DONE (testnet), 1 contract mainnet-only

**Owner decision**: relaunching as a brand-new product, so every contract in
`packages/contracts/src` deploys under the `Levier*` names. The earlier version
of this section listed most contracts as blocked. Those blockers turned out to
be avoidable on testnet, and 18 of 19 contracts are now live on RH Testnet
(chain 46630). Addresses are in `packages/contracts/deployments/testnet-46630.json`
(core), `pons-testnet-46630.json` (Pons group) and `.secrets/rh-live/state.json`
(margin group, journaled).

- **Pons group — deployed.** `PonsOracleRouter`, `PonsMarketAdapter`,
  `PonsLeverageRegistry`, `PonsRiskEngine`, `LeveragePositionManager`,
  `PonsAutoProtectModule`, plus `CompositeSanityOracle` and mock `PMEME`/`PGOV`
  tokens, via `packages/contracts/script/DeployPons.s.sol` (now reuses the real
  faucet USDG through `USDG_ADDRESS` and writes
  `deployments/pons-testnet-46630.json`). The mock tokens and the manual
  graduation flags exist for testing only. A real Levier Pons token is still a
  separate product decision (see §5).
- **Margin group — deployed and accepted.** `MarginRouter`,
  `RhShortReferenceOracle`, the short `LevierPair`, and a UniswapV2 factory and
  TSLA/USDG pool. The earlier "blocked, needs a Robinhood DEX factory" note was
  wrong: `pnpm deploy:rh-margin` deploys its own V2 factory and pool from the
  vendored bytecode in `packages/contracts/vendor/uniswap-v2-core/`. The funded
  long and short open/close acceptance cycle passed. Run it with
  `levier testnet deploy margin`.
- **`VerifiedFeedOracle` — not deployed.** Needs a real Chainlink-style L2
  sequencer uptime feed, which exists on mainnet only.
- **Additional stock markets (AAPL/SPY/NVDA and AMZN/PLTR/NFLX/AMD) — not
  deployed.** No published testnet token addresses. The expansion pipeline
  (`pnpm rh:markets:*`) exists but has no approved draft in `.env.testnet`
  (`RH_EXPANSION_DRAFT_JSON`).

### Phase 13.7 — Testnet Website Enablement & Publisher Stability — Status: DONE

Found while making the deployed site testable (`https://levier-testnet.up.railway.app`):

- The markets stayed hidden because `MARKET_DEPLOYMENTS_JSON` had `enabled:false`
  and `MARGIN_TRADING_ENABLED` / `LENDING_ENABLED` were `false` on the Railway
  `web` service. Build-time ARGs in the `Dockerfile` mean any change needs a
  rebuild. `levier testnet enable` applies them.
- `/trade` was wired only to the Pons market client. `MarginTradePanel` was never
  mounted, so a configured stock/USDG market showed "Market not found".
  `apps/web/src/app/trade/page.tsx` now opens the margin panel when the asset
  matches a configured market.
- `/api/margin/history` and `/api/lending/history` returned 503 because the
  explorer's `next_page_params` gained extra keys (`value`, `hash`,
  `inserted_at`, `fee`) that the strict cursor schema rejected.
  `historyCursorSchema` now allows them, each strictly validated.
- The price publisher kept stopping and pausing the markets. Causes found:
  (1) `OWNER_PAUSE_BUDGET_REQUIRED`, because `maxTransactionGasCostWei` of 1e15 in
  `RH_PUBLISHER_POLICY_JSON` made the pause reserve exceed the signer budget; it is
  now 1e14; (2) the Kraken USDG websocket answered HTTP 429 after too many
  connections, so `intervalMs` is now 45000 and the restart loop waits 90 s;
  (3) `unsupported block number` from a lagging RPC node, now retried in
  `scripts/lib/rh-live.mjs`. Failures that used to be fully redacted now leave a
  masked trace in `.secrets/rh-live/publisher-errors.log`.
- The publisher activates the markets itself and requires them paused at start.
  Do not un-pause markets by hand before starting it. Keep it running with
  `levier testnet publisher`.
- Verified through the deployed UI with a signing test wallet: open and close of
  a Long and a Short, and deposit, borrow, repay and withdraw on `/lending`.
  A real browser-wallet session has not been recorded yet.

### Phase 14 — ABI Regeneration + Frontend Contract Bindings — Status: DONE

**Strictly sequential after Phase 13** — depends on its renamed contract
names. Own PR, gated by a `pnpm build` (web) typecheck.

- Regenerate ABIs (`pnpm generate:lending-abis`, per root `package.json`).
- Update `apps/web/src/contracts/abis.ts`, `addresses.ts`,
  `generated/{lending,margin,modules}.ts`, `apps/web/src/lib/contracts/
*.json`, `apps/web/src/lib/contracts/index.ts`.

**Real bugs found and fixed, beyond the doc's original file list** — Phase
13's contract rename left the frontend with broken imports, not just
stale strings:

- `apps/web/src/contracts/abis.ts` — hand-written `LeveraRouterABI`,
  `LeveraPairABI`, `LeveraVaultABI` stubs, unrenamed since they're JS
  identifiers, not string literals a grep-based rename would flag.
- `apps/web/src/lib/lending-client.ts`, `lending-history.ts`,
  `margin-history.ts`, `margin-client.ts`, `analytics.ts` — imported
  `LeveraPairABI`/`LeveraMarketRegistryABI` from
  `contracts/generated/lending.ts`, which no longer exports those names
  after ABI regen — **this was a broken build**, not cosmetic.
  `apps/web/src/hooks/useVaultDeposit.ts` — same issue for
  `LeveraVaultABI`.
- `apps/web/src/contracts/addresses.ts` — `ProtocolAddresses` interface
  still had `leveraRouter`/`leveraVault` fields (same class of gap as
  Phase 13.5's `environment.cjs` fix); `useVaultDeposit.ts` was the one
  consumer of the stale field name.
- Comment/log-string gaps: `useAutoProtect.ts` ("Levera API" log),
  `useVaultDeposit.ts` (comment), `chinese-equities-client.ts`
  (`levera_chinese_positions_v1` localStorage key).
- A stale, gitignored `apps/web/.env.local` (all-dummy `0x1111...`
  addresses, predating this deploy) was silently shadowing the real
  `apps/web/.env` — Next.js loads `.env.local` with higher priority.
  Removed so the build actually typechecks against the real Phase 13.5
  testnet addresses, which is the point of this gate.
- **Not fixed, flagged instead**: `@LeveraMarke6` X/Twitter handle in
  `Header.tsx`, `Footer.tsx`, `FAQSection.tsx`, `MobileNavigation.tsx` —
  this is Phase 16 (owner/product decision, needs a real new handle), not
  a text substitution.
- Gate passed: `pnpm build` (web) — compiled, typechecked, all 16 routes
  generated clean.

### Phase 15 — Deployment / Infra Labels (manual, outside repo, any time) — Status: DONE

- Railway project `levier` created fresh (testnet environment) — named
  correctly from creation, no legacy `levera` label ever existed to rename.
  Old unrelated `alphamarkets` project deleted to free the free-tier slot.
- Docker image labels/tags — checked, no `levera` references found.
- CI job names/badges — none exist in this repo (only vendored
  `forge-std`'s own CI, out of scope per §5).
- Services deployed: `web` (https://levier-testnet.up.railway.app) and
  `backend` (api+indexer+oracle+keeper combined).
- Supabase project also named `levier` (project ref `eznetewzedfptgvighvj`).

### Phase 16 — Domain & External Assets (non-code, flag only, any time)

- Logo and brand assets.
- Social handles (Pons sample data shows an existing `@LeveraMarke6`
  Twitter handle tied to the old brand's launched token — unrelated to our
  codebase, just noting it exists).
- Explorer bookmarks / external links.
- Owner/product decision, not an engineering task.

### Parallel-safe groups (run on separate branches simultaneously)

- **Group A**: Phase 5 + Phase 6 (disjoint env files).
- **Group B**: Phase 8 → then {9a, 9b, 9c in parallel} → then Phase 10
  (shell first, then parallel page areas, then hooks last).
- **Group C**: Phase 11 (backend) parallel with all of Group B and
  Phase 10.5.
- **Group D**: Phase 12 (seed/data) parallel with everything.
- **Group E**: Phase 15 + Phase 16 parallel with everything, any time.

### Strictly sequential chains (cannot parallelize)

- Phase 2 → Phase 4 → everything that imports packages (package identity
  must be stable before other phases touch import lines).
- Phase 13 → Phase 14 (ABI/bindings depend on the renamed contract names).
- Phase 8 → Phase 9a/9b/9c → Phase 10 → Phase 10.5 (shared shell, then
  pages, then hooks, then restyle — avoids the same files being touched
  twice in overlapping PRs).

## 4. File-by-File Mapping

- **#1** — `README.md` — Phase 1 — Title, prose, badges
- **#2** — `packages/types/package.json` (`name`) + every `workspace:*`/import consumer — Phase 2 — `@levera/types` → `@levier/types`
- **#3** — `packages/contracts/package.json` (`name`) — Phase 3 — `@levera/contracts` → `@levier/contracts` (package identity only, not Solidity source)
- **#4** — Root `package.json` (`name`), `apps/web/package.json`, `apps/api/package.json`, `apps/indexer/package.json`, `apps/keeper/package.json`, `apps/price-oracle/package.json` — Phase 4 — `levera-monorepo` → `levier-monorepo`; `@levera/*` → `@levier/*` name fields
- **#5** — Root `package.json` scripts, `turbo.json`, `nixpacks.toml`, `Dockerfile` — Phase 4 — `--filter=@levera/...` references
- **#6** — `pnpm-lock.yaml` — Phase 4 (auto) — Regenerated by `pnpm install`, never hand-edited
- **#7** — `.env.example`, `.env.mainnet.example`, `.env.mainnet.core.example`, `.env.testnet.example` — Phase 5 — Comments/default values
- **#8** — `apps/api/.env.example`, `apps/keeper/.env.example`, `apps/web/.env.mainnet.example`, `apps/web/.env.testnet.example` — Phase 6 — Comments/default values
- **#9** — `apps/web/config/environment.cjs`, `apps/web/config/margin.cjs`, `apps/web/next.config.js` — Phase 7 — Comments/default display strings
- **#10** — `Header.tsx`, `Footer.tsx`, `HeroSection.tsx`, `FAQSection.tsx`, `HowItWorks.tsx`, `ComparisonMatrix.tsx`, `layout.tsx` — Phase 8 — Shared shell copy, do first among UI
- **#11** — Core product pages/components (markets, trade, earn, portfolio, analytics) under `apps/web/src/app/` and `apps/web/src/components/` — Phase 9a — Visible UI copy + comments
- **#12** — `apps/web/src/components/china/*`, `apps/web/src/app/markets/china/*` — Phase 9b — Visible UI copy + comments, own directory
- **#13** — `apps/web/src/app/markets/pons`, `apps/web/src/app/api/{markets,pons}/pons`, `usePonsMarkets.ts` — Phase 9c — Visible UI copy + comments, own directory
- **#14** — `apps/web/src/hooks/useLeveraMarkets.ts`, `useLeveraPortfolio.ts`, `useLeveraVault.ts` — Phase 10 — Rename file + symbol + call sites
- **#15** — `apps/web/src/app/globals.css` — Phase 10 — Check brand-named custom properties
- **#14b** — `apps/web/src/app/`, `apps/web/src/components/`, `globals.css` — Phase 10.5 — Full visual restyle, not brand-string rename
- **#16** — `apps/api/src/index.ts`, `apps/api/src/routes/{activity,autoProtect,markets,portfolio,positions,vaults}.ts` — Phase 11 — Comments/log strings
- **#17** — `apps/keeper/src/client.ts`, `src/index.ts`, `src/services/{executionService,positionMonitor}.ts` — Phase 11 — Comments/log strings
- **#18** — `supabase/seed.sql` — Phase 12 — Vault slugs + display names
- **#19** — `data/markets.json`, `data/vaults.json`, `data/chinese-equities-markets.json`, `data/chinese-equities-proofs.json` — Phase 12 — Display-name fields
- **#20** — `supabase/migrations/20260915000001_init_schema.sql` — Phase 1 (comment only) — Header comment only; no schema rename needed
- **#21** — `packages/contracts/src/core/LeveraPair.sol`, `registry/LeveraMarketRegistry.sol`, `routers/LeveraRouter.sol`, `vaults/LeveraVault.sol` — Phase 13a — Contract identifier + filename rename
- **#22** — `packages/contracts/src/modules/AutoProtectModule.sol`, oracle/pons/trading contracts referencing renamed types — Phase 13a — Update type references
- **#23** — `packages/contracts/script/DeployLevera.s.sol` + sibling deploy scripts — Phase 13b — Update references
- **#24** — `packages/contracts/test/LeveraCore.t.sol`, `LeveraInvariants.t.sol`, `LeveraVault.t.sol`, other affected tests — Phase 13c — Update references
- **#24b** — `scripts/generate-lending-abis.mjs`, `scripts/rh-live.mjs`, `scripts/prepare-rh-suite.mjs`, `scripts/simulate-rh-modules.mjs`, `scripts/finalize-rh-deployment.mjs`, `scripts/deploy-rh-margin.mjs`, `scripts/accept-rh-margin.mjs`, `scripts/deploy-rh-expansion.mjs`, `scripts/accept-rh-expansion.mjs`, `scripts/plan-rh-expansion.mjs`, `scripts/pause-rh-markets.mjs`, `scripts/prepare-rh-mainnet-core.mjs`, `scripts/deploy-rh-mainnet-core.mjs`, `scripts/run-rh-publisher.mjs`, `scripts/verify-rh-indexer.mjs`, `scripts/verify-rh-wallet-cycle.mjs`, `scripts/lib/rh-indexer.mjs`, `scripts/lib/rh-modules.mjs` — Phase 13d — Hardcoded `LeveraPair`/`LeveraRouter`/`LeveraMarketRegistry`/`LeveraVault` artifact/ABI-import names; found by direct grep, not in the original repo-wide survey — must land with 13a–13c
- **#25** — `apps/web/src/contracts/abis.ts`, `addresses.ts`, `generated/{lending,margin,modules}.ts`, `src/lib/contracts/*.json`, `src/lib/contracts/index.ts` — Phase 14 — Regenerate after contract rename (depends on #24b's `generate-lending-abis.mjs` being fixed first)
- **#25b** — `packages/contracts/deployments/testnet.json`, `deployments/DEPLOYMENT_RECEIPT.md` (new entries) — Phase 13.5 — New Levier testnet deployment record, added alongside the legacy record
- **#26** — `packages/contracts/deployments.json`, existing `deployments/testnet.json` entries, existing `deployments/DEPLOYMENT_RECEIPT.md` entries — Phase 13/14 (no change) — Historical record of legacy deployment — leave as-is unless redeploying
- **#27** — Railway project/service names, Docker labels, CI badges — Phase 15 — Manual dashboard steps
- **#28** — Logo, social handles, explorer bookmarks — Phase 16 — Product/owner decision

## 5. Out of Scope (explicit no-action)

- **`pnpm-lock.yaml`** manual edits — always regenerate via `pnpm install`.
- **`packages/contracts/lib/forge-std/README.md`** — vendored third-party
  library; its match is the unrelated word "leverages", not the brand.
- **`mainnet_pons_below_1m.json`** (and similar `scripts/test-mainnet-pons-*`
  sample outputs) — real on-chain data showing an already-launched Pons
  memecoin token named "Levera Markets" (symbol `LEVERA`) with its own
  Twitter handle. This is external fact data captured by a test script, not
  our branding — cannot and should not be renamed. Whether Levier wants its
  own Pons-launched token later is a separate, future decision.
- **Already-deployed RH Testnet contract addresses** — immutable on-chain
  facts; Phase 6 renames source only, deployment records stay as historical
  reference until/unless a redeploy is separately planned.

## 6. Risks & Sequencing

- **Phases 2 → 4 must land in order, before anything else that imports by
  package name.** `packages/types` (Phase 2) is a leaf with no internal
  deps, safest first; the remaining app packages (Phase 4) touch shared
  root files (`package.json`, `Dockerfile`, `turbo.json`, `nixpacks.toml`)
  and must land as one pass — a half-renamed workspace breaks every build.
- **Phase 13 is highest risk, and bigger than it first looks.** It
  touches Solidity source, deploy scripts, tests, **and** 18 root-level
  `scripts/*.mjs` deploy-orchestrators that hardcode the old contract
  names (13a–13d must be one commit; can't compile or deploy
  half-renamed) — do it in its own PR, after Phases 1–12 are merged and
  stable, gated by `forge build` + `forge test` + the scripts-grep check
  (13e).
- **Phase 13.5 must land before §8 is even reachable** — it's the proof
  that the rename didn't silently break the testnet deploy pipeline.
  Skipping straight to mainnet after Phase 14 would mean deploying
  contracts that have never actually run under their new name.
- **Phase 14 is strictly sequential after Phase 13** — ABI regen depends
  on `scripts/generate-lending-abis.mjs`'s renamed contract list (13d)
  and the new contract names; never run in parallel with 13.
- **Phase 8 → {9a, 9b, 9c} → Phase 10 is a strict order within the UI
  work** — shared shell first (alone), then the three disjoint page-area
  phases (safe in parallel with each other), then hook renames last, so
  no two phases touch the same component file in overlapping PRs.
- **Phase 10.5 (restyle) must wait for the full UI rename chain
  (8 → 9a/9b/9c → 10)** — same reasoning as the bullet above: a visual
  restyle touches the same component files as the rename phases, so it
  can't run concurrently without two initiatives fighting over the same
  lines in overlapping PRs.
- **Parallel-safe at any time**: Phase 6 alongside Phase 5 (Group A);
  Phase 11 (backend) alongside the whole Phase 8–10 UI chain (Group C);
  Phase 12 (seed/data) alongside everything (Group D); Phase 15–16
  alongside everything (Group E) — see §3's parallel-safe groups for the
  full list.
- **Phase 12 (DB/data) carries no schema risk** — only seed data changes,
  trivially re-run in any environment.
- **Phases 15–16 are not code changes** — track them as a checklist, not
  a code review, since they live outside the repository.

## 7. Suggested Verification per Phase

- **Phase 1**: `grep -ri "levera" README.md *.md` returns nothing new.
- **Phase 2**: `grep -r "@levera/types" .` returns nothing; every consumer
  still resolves `@levier/types`; `pnpm build:backend` succeeds.
- **Phase 3**: `packages/contracts/package.json` name is `@levier/contracts`;
  no other file changed.
- **Phase 4**: `pnpm install` completes clean; `pnpm -r exec -- node -e
"console.log(require('./package.json').name)"` (or equivalent) confirms
  every workspace package resolved under `@levier/*`; `pnpm build` and
  `pnpm build:backend` both succeed.
- **Phase 5–7**: `grep -ri "levera" <changed env/config paths>` returns
  nothing new; app still boots locally with `.env` copied from the
  updated examples.
- **Phase 8–9c**: visual check of each touched page/component in dev
  (`pnpm dev`); `grep -ri "levera"` on the touched directory returns
  nothing new.
- **Phase 10**: `grep -r "useLevera" apps/web/src` returns nothing;
  `pnpm build` (web) typechecks clean.
- **Phase 11**: `grep -ri "levera" apps/api/src apps/keeper/src` returns
  nothing new; `pnpm build:backend` succeeds.
- **Phase 12**: re-run the seed script against a scratch DB; confirm new
  `levier-*` vault slugs appear; `grep -ri "levera" data/*.json
supabase/seed.sql` returns nothing new.
- **Phase 13**: `forge build` succeeds under new contract names; `forge
test` passes; `grep -rn "LeveraPair\|LeveraRouter\|LeveraMarketRegistry\|
LeveraVault" scripts/ packages/contracts/src packages/contracts/script
packages/contracts/test` returns nothing.
- **Phase 13.5**: testnet deploy pipeline completes without error; the
  deposit/borrow/repay/withdraw TSLA/USDG lifecycle passes under the new
  contract names, same as the original result; new addresses recorded.
- **Phase 14**: `pnpm generate:lending-abis` regenerates ABIs without diff
  surprises; `pnpm build` (web) typechecks against the regenerated
  bindings.
- **Final**: repo-wide `grep -ri "levera"` returns only the explicitly
  out-of-scope items from §5 (or nothing, if those are also excluded from
  the search path).

## 8. Pre-Mainnet Deployment Checklist

Gate to clear before flipping any mainnet trading flag. **Smart-contract
audit is explicitly skipped per decision** — item deliberately absent from
this checklist, not forgotten; track it as an accepted risk separately if
that decision changes later.

### 8.0 Cost Policy — Verify Free, Pay Only Once at Launch

**Every check in this list is free to verify.** Run it against RH Testnet
(already faucet-funded via `USDG_FAUCET_URL`, chain 46630) or a
forked-mainnet dry-run (`forge script --fork-url <mainnet RPC> ...`
**without** `--broadcast` — simulates against real mainnet state, spends
zero gas). Reading chain state and calling public price APIs (Pyth,
Kraken, Robinhood quotes) never costs gas either — only broadcasting a
transaction does.

Exactly **two** items in this checklist are unavoidable real money, both
one-time at actual launch, never a repeated test cost:

1. The mainnet contract deploy broadcast itself (end of Phase 13/14).
2. Minimal one-time funding of `DEPLOYER_ADDRESS` (to deploy) and
   `KEEPER_ADDRESS` (to run the keeper afterward) with native gas token.

Every other checklist item below is marked `(free)` and should be
rehearsed on testnet/dry-run before the two real-money steps happen.

### 8.1 Rebranding gate — (free) — Status: DONE (engineering phases)

- [x] Phases 1–14 complete; final repo-wide `grep -ri "levera"` returns
      only §5 out-of-scope items (Pons external data, legacy chain-31337
      deployment records) and the `@LeveraMarke6` social handle (Phase 16,
      owner decision). Phase 13.6 is done on testnet apart from `VerifiedFeedOracle` and extra stock
      markets, and Phase 15/16 (manual/product) remain open by design — see those sections.
      **Real Phase 1 gap found and fixed while running this gate**:
      `README.md`'s architecture diagram, contract-description table, and
      deployment-status table still said `Levera*` throughout — Phase 1
      only fixed the title/badges/prose, missed the diagrams/tables. Also
      updated the deployment table to the real Phase 13.5 addresses
      (was still showing the pre-rename legacy deployment). Also found:
      `packages/contracts/package.json`'s `deploy:anvil` script and
      `scripts/record_deployment.ts` still pointed at
      `DeployLevera.s.sol` — broken references, since Phase 13 renamed
      that file to `DeployLevier.s.sol`.
- [x] Phase 13/14 (contract rename + ABI regen) verified with `forge build`
    - `forge test` (124/124) + web typecheck green — confirmed in Phase
      13/13.5/14 sections above. No `Levera*`-named contracts going to
      mainnet.

### 8.2 Contract deployment governance

- [ ] `MAINNET_DEPLOYMENT_SCOPE` set intentionally (`CORE_ONLY` or full),
      reviewed by whoever owns the deploy — (free, config read).
- [ ] `PROTOCOL_OWNER_ADDRESS` confirmed as the intended owner (multisig,
      if that's the design) — not a personal/dev key — (free, address check).
- [ ] Full deploy sequence rehearsed with the repo's own mainnet-core
      pipeline, dry-run only: `pnpm rh:mainnet:core:prepare` →
      `pnpm rh:mainnet:core:plan` — (free, `plan` never broadcasts, spends
      zero gas). Don't hand-roll a generic `forge script` command — this
      pipeline already exists and is what Phase 13.5's testnet run also
      exercises, so rehearsing with it here is the same tooling, same
      confidence.
- [ ] `DEPLOYER_ADDRESS` funded with enough native gas token for the real
      deploy — **the one unavoidable real-money step from §8.0, item 2; do
      this once, right before running `pnpm rh:mainnet:core:deploy`, not for
      every `:plan` rehearsal.**
- [ ] Gas budget vars sane and reviewed: `MAINNET_MAX_TRANSACTION_GAS_WEI`,
      `MAINNET_MAX_TOTAL_GAS_WEI`, `MAINNET_MAX_FEE_PER_GAS_WEI`,
      `MAINNET_MINIMUM_GAS_RESERVE_WEI`, `MAINNET_GAS_LIMIT_BUFFER_BPS` —
      (free, config read; values can be sanity-checked against the fork
      dry-run's gas report).
- [ ] `MAINNET_CORE_BROADCAST_ENABLED` left `false` until the actual go
      moment — flip last, not early — (free, config).
- [ ] `MAINNET_RECEIPT_CONFIRMATIONS` / `MAINNET_RECEIPT_TIMEOUT_MS` set to
      values appropriate for mainnet block times (not copied from testnet) —
      (free, config).
- [ ] Post-deploy addresses (`MAINNET_MARKET_REGISTRY_ADDRESS`,
      `MAINNET_LENDING_ROUTER_ADDRESS`, `MAINNET_AUTO_PROTECT_ADDRESS`,
      `MAINNET_SHORT_ROUTER_ADDRESS`, `MAINNET_LEVERA_VAULT_ADDRESS` — rename
      to `LEVIER_VAULT_ADDRESS` per Phase 13) recorded in a deployment receipt
      once known, same pattern as `deployments/DEPLOYMENT_RECEIPT.md` — (free,
      happens right after the one real deploy, no extra cost of its own).

### 8.3 Oracle & price feed readiness — (free)

- [ ] Continuous price publisher running with health checks and source
      validation (closes README's OPS-01 item) — not just observed once
      manually. Reads only, no gas — run it against testnet or mainnet
      read-only RPC either way.
- [ ] Robinhood quotes API, Pyth Hermes, and Kraken (USDG/USD) endpoints
      all confirmed reachable from the deployment environment — plain HTTP
      reachability check (`curl`), all three have free public endpoints.
- [ ] `PYTH_MAX_CONFIDENCE_BPS`, `ORACLE_MAX_QUOTE_AGE`,
      `ORACLE_MAX_SKEW`/spread-bps settings reviewed for mainnet risk
      tolerance (testnet defaults may be too loose) — config review only.
- [ ] `scripts/check-reference-prices.mjs --runtime` run clean — a script
      run, no transaction broadcast.

### 8.4 Indexer & canonical data integrity — (free)

- [ ] Canonical event indexing has idempotency and reorg recovery in place
      (closes README's OPS-03 item) — verify with a deliberate reorg/replay
      test on RH Testnet or a local `anvil --fork-url` fork, not a real
      mainnet event.
- [ ] `rh_lending_checkpoints` / `rh_lending_batches` / `rh_lending_events`
      / `rh_lending_accounts` migrated and reachable on the mainnet Supabase
      project — schema migration on Supabase's free tier costs nothing.
- [ ] Indexer running continuously against mainnet RPC before any trading
      flag flips — reading blocks never spends gas, only broadcasting does.

### 8.5 Feature flags — deliberate, not default — (free)

- [ ] `TRADING_ENABLED`, `LENDING_ENABLED`, `MARGIN_TRADING_ENABLED`
      reviewed one by one and set to the intended launch state — never left at
      inherited defaults without a conscious decision per flag — config only.
- [ ] Browser-wallet acceptance flow for `/lending` built and tested
      (closes README's OPS-02 item) — rehearse on RH Testnet with a
      faucet-funded wallet (`USDG_FAUCET_URL`), zero cost.
- [ ] Long/Short swap execution and closing flows implemented and tested
      (closes README's PRODUCT-01 item) if those products are part of this
      launch — rehearse on RH Testnet, faucet-funded, zero cost.
- [ ] Vault allocation/interest and Auto-Protect collateral-funded
      execution implemented (closes README's PRODUCT-02 item) if Earn/vaults
      are part of this launch — rehearse on RH Testnet, faucet-funded, zero
      cost.

### 8.6 Security hygiene (non-audit) — (free)

- [ ] `pnpm security:check` (`scripts/security-check.mjs`) run clean — no
      secret values leaking into browser-exposed bundles — local script run.
- [ ] Mainnet `.env` values (RPC URLs, Supabase service role key, keeper
      private key, deployer private key) confirmed **not** committed anywhere
      in the repo or in build ARGs baked into the Docker image (only
      `NETWORK_MODE`/`CHAIN_ID`/public addresses should be build-time ARGs,
      per the Dockerfile's own documented policy) — a file/config review.
- [ ] `/api/rpc` proxy bounds reviewed for mainnet load:
      `RPC_TIMEOUT_MS`, `RPC_MAX_BATCH_SIZE`, `RPC_MAX_BODY_BYTES`,
      `RPC_MAX_RESPONSE_BYTES` — config review only.
- [ ] Keeper private key stored in a secrets manager, not a plain env file
      on disk, for the mainnet environment — a setup step, not a cost.

### 8.7 Auto-Protect / keeper readiness

- [ ] Keeper's deleverage execution **rehearsed end-to-end on RH Testnet**
      (README currently lists `AutoProtectModule` as "Paused; deleveraging
      incomplete" on testnet — confirm this is resolved there first) — (free,
      faucet-funded testnet, no real gas). Do not spend real gas running this
      as a repeated "test" on mainnet; the first live mainnet cycle happens
      naturally as part of launch monitoring, not a separate paid test.
- [ ] `MAX_GAS_PRICE_GWEI` and `POLL_INTERVAL_MS` tuned for mainnet gas
      conditions, not testnet values — (free, config review; can sanity-check
      against the forked dry-run's gas numbers from §8.2).
- [ ] `KEEPER_ADDRESS` funded and monitored for balance so it can't run
      out of gas mid-liquidation-protection — **the other unavoidable
      real-money step from §8.0, item 2; a minimal one-time top-up to run the
      service, not a per-test cost.**

### 8.8 Frontend production readiness — (free)

- [ ] Production build (`pnpm build`) and typecheck pass clean —
      point the build at testnet contract addresses/ABIs first; re-point at
      mainnet addresses only after Phase 13/14 land, still just a build.
- [ ] No testnet/dev default values (chain ID, RPC URL, contract
      addresses) hardcoded anywhere outside the env-driven config — code
      review.
- [ ] UI correctly reflects the actual state of each feature flag (no
      buttons/flows visible for a product that's still disabled) — checkable
      against testnet with the flags toggled either way.

### 8.9 Database & RLS — (free)

- [ ] RLS policies on `users`, `markets`, `user_positions`, `vaults`,
      `activity_logs`, `auto_protect_configs` reviewed for the mainnet network
      scope specifically (not just copy-pasted testnet assumptions) — policy
      review, no data cost.
- [ ] `rh_lending_*` canonical tables confirmed to have all client
      privileges revoked (`public`/`anon`/`authenticated`) on the mainnet
      project, same as testnet — a Supabase free-tier project works for this
      check before real usage volume exists.
- [ ] Seed data appropriate for mainnet — no leftover testnet placeholder
      rows (mock TVL/APY numbers) visible to real users — a seed script
      re-run.

### 8.10 Operational readiness & rollback — (free)

- [ ] Rate limits and public exposure controls in place (closes README's
      RELEASE-01 item) — this protocol will be publicly reachable — config/
      code, testable by hitting the testnet-pointed API.
- [ ] Recovery runbook written: who flips which env var / calls which
      script to pause markets fast (`scripts/pause-rh-markets.mjs`) if
      something goes wrong right after launch — rehearse the script against
      RH Testnet, zero cost.
- [ ] Monitoring/alerting wired for: oracle staleness, indexer lag,
      keeper liveness, RPC error rate — setup and dry-run alerts against
      testnet data.
- [ ] A tested path to quickly set `TRADING_ENABLED` /
      `LENDING_ENABLED` / `MARGIN_TRADING_ENABLED` back to `false` without a
      full redeploy, in case of an emergency pause — rehearsed by actually
      flipping it on a testnet-pointed deployment, free.

### 8.11 Explicitly excluded from this checklist

- Smart-contract security audit — skipped per decision. If this changes,
  add it back as its own gate before Phase 13's contracts are trusted
  with real user funds on mainnet.

## 9. Fast Deploy Runbook (testnet → mainnet, copy-paste order)

Everything above in one command sequence. Steps 1–6 are free (testnet/
dry-run); step 7 is the one real-money broadcast (§8.0).

1. **Rename gate** — Phases 1–12 merged; Phase 13 (13a–13e) merged with
   `forge build` + `forge test` green and the scripts-grep gate clean.
2. **Testnet deploy** (Phase 13.5, free):
   `pnpm prepare:rh-suite` → `pnpm simulate:rh-modules` →
   `pnpm deploy:rh-modules` → `pnpm finalize:rh-deployment` →
   `pnpm rh:lending:status`.
3. **Testnet lifecycle proof** (free): re-run the deposit → borrow →
   repay → withdraw TSLA/USDG cycle; confirm parity with the original
   result; record new addresses in `deployments/testnet.json` +
   `DEPLOYMENT_RECEIPT.md`.
4. **ABI/frontend regen** (Phase 14, free): `pnpm generate:lending-abis` →
   `pnpm build` (web) typecheck against the new testnet addresses.
5. **Clear §8** — walk 8.1–8.10; every item is free, testable against the
   testnet deployment from step 2.
6. **Mainnet dry-run** (§8.2, free): `pnpm rh:mainnet:core:prepare` →
   `pnpm rh:mainnet:core:plan`.
7. **Mainnet deploy** (the one real-money step, §8.0):
   fund `DEPLOYER_ADDRESS` → `pnpm rh:mainnet:core:deploy` →
   `pnpm rh:mainnet:core:verify` → fund `KEEPER_ADDRESS` → record
   addresses in a new deployment receipt (§8.2's last item).
8. Flip `TRADING_ENABLED` / `LENDING_ENABLED` / `MARGIN_TRADING_ENABLED`
   deliberately (§8.5), one at a time, monitoring after each.
