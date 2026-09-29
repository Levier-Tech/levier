---
id: project-specs
aliases: []
tags: []
---

# Levier — Project Specifications

> Baseline reference for the codebase inherited from LEVERA Markets, before rebranding.

## 1. Overview

**Product**: a DeFi credit and leverage protocol for tokenized real-world assets
(RWAs) — specifically tokenized equities and ETFs (TSLA, AAPL, NVDA, SPY, META,
AMZN, MSFT, GOOGL, plus Chinese ADRs such as BABA/FUTU) — built on **Robinhood
Chain** (EVM chain; testnet chain ID `46630`, mainnet chain ID `4663`).

It offers a brokerage-style margin experience through six core actions:
**Borrow, Earn, Long, Short, Multiply, Auto-Protect**, executed over **isolated
lending markets** — one risk-siloed pair per asset, so a bad oracle or liquidity
event in one asset cannot cascade into others.

**Current status (as of last README update)**: core lending is deployed and
verified on RH Testnet (8 contracts). The direct-pair lending lifecycle
(deposit → borrow → repay → withdraw) has passed with real TSLA/USDG. **Public
trading remains disabled** pending:

- a continuous price publisher with health checks and source validation,
- browser-wallet acceptance flow for `/lending`,
- canonical event indexing with idempotency and reorg recovery,
- long/short swap execution and closing flows,
- vault allocation/interest and Auto-Protect collateral-funded execution,
- public exposure controls, rate limits, recovery runbooks.

This is reflected in code: e.g. `apps/api/src/routes/liquidations.ts` returns
HTTP 503 for canonical multi-market risk analytics, and feature-gate flags
(`TRADING_ENABLED`, `LENDING_ENABLED`, `MARGIN_TRADING_ENABLED`) default false.

## 2. Core Features

- **Borrow** — deposit collateral (tokenized equity), borrow the protocol
  stablecoin `USDG`, per isolated pair.
- **Earn** — supply into ERC-4626 yield vaults that route stablecoin deposits
  across isolated lending pairs.
- **Long / Multiply** — atomic leverage entry (up to 2.5x) in one transaction:
  deposit → borrow → swap → re-supply, via `LeverageRouter`.
- **Short** — atomic short execution via `ShortRouter`.
- **Auto-Protect** — offchain keeper bot that watches account health (loan-to-
  value ratio) and automatically deleverages a position before liquidation,
  based on user-set `triggerLtv` / `targetLtv`.
- **Isolated markets** — each tokenized asset trades in its own pair with its
  own risk tier (Tier A / B / C / Experimental), registered in
  `LeveraMarketRegistry`.

### Secondary domains already present in code (not in top-level README)

- **Pons integration** — a separate bonding-curve/memecoin launchpad on
  Robinhood Chain (factory `0x7eD598...EC7e`). An indexer
  (`scripts/run-pons-indexer.mjs`) detects tokens that have "graduated" the
  bonding curve (met liquidity/volume/market-cap thresholds) and marks them
  leverage-eligible via `PonsMarketAdapter`, `PonsLeverageRegistry`,
  `PonsRiskEngine`, `PonsOracleRouter`, `PonsAutoProtectModule`.
- **Chinese-equity ADR markets** — frontend route `apps/web/src/app/markets/china`
  and `data/chinese-equities-*.json` config, expanding beyond US equities.

## 3. Architecture

Monorepo managed with **Turborepo** + **pnpm workspaces** (`apps/*`,
`packages/*`).

| Path                 | Package name           | Role                                                                                                                                                     | Stack                                                       |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web`           | `@levera/web`          | Frontend. Next.js 14 App Router. Talks only to `apps/api` — never directly to Supabase or RPC providers (RPC calls proxied via `/api/rpc`).              | Next.js 14, React 18, Wagmi, Viem, TanStack Query, Tailwind |
| `apps/api`           | `@levera/api`          | Express REST gateway in front of Supabase; TTL caching (10s markets, 30s vaults, 15s liquidations) to protect Supabase free-tier egress.                 | Express 4, TypeScript, Zod, `@supabase/supabase-js`         |
| `apps/indexer`       | `@levera/indexer`      | Syncs on-chain events into Supabase.                                                                                                                     | Node, TypeScript, Viem                                      |
| `apps/keeper`        | `@levera/keeper`       | Auto-Protect bot: `services/positionMonitor.ts` watches LTV, `services/executionService.ts` executes on-chain deleverage.                                | Node, TypeScript, Viem                                      |
| `apps/price-oracle`  | `@levera/price-oracle` | Reference price feed pulling from Robinhood quotes API, Kraken (USDG/USD), Pyth Hermes.                                                                  | Node, TypeScript, `undici`                                  |
| `packages/contracts` | `@levera/contracts`    | Solidity contracts (Foundry).                                                                                                                            | Solidity 0.8.24, OpenZeppelin v5, Foundry/Forge             |
| `packages/types`     | `@levera/types`        | Shared TypeScript types (`NetworkMode`, `PositionType`, `MarketStatus`, `TokenConfig`, `MarketConfig`, `VaultConfig`, etc.), consumed via `workspace:*`. | TypeScript                                                  |

Root package name: `levera-monorepo`. Node `>=22`, pnpm `9.0.0`.

Request flow (per README):

```
User / Web3 Wallet
       │
       ▼
  LeveraRouter ─────────────┐
       │                     │
       ├── LeverageRouter    │  (Atomic Long & Multiply)
       ├── ShortRouter       │  (Atomic Short)
       └── AutoProtectModule │  (Keeper Deleverage)
              │
              ▼
       LeveraPair (Isolated Lending)
              │
              ▼
   RhTestnetReferenceOracle
              │
       LeveraMarketRegistry (Risk Tiers A/B/C/Experimental)
              │
       LeveraVault (ERC-4626 Yield)
```

## 4. Tech Stack

| Layer                              | Technology                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                           | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Wagmi v3, Viem, TanStack Query, Zod env validation (`@t3-oss/env-nextjs`), Lightweight Charts |
| Backend API                        | Express 4, TypeScript, Zod, `@supabase/supabase-js`                                                                                                        |
| Indexer / Keeper / Oracle services | Node + TypeScript (`tsx`), Viem, `undici`                                                                                                                  |
| Database                           | Supabase (managed PostgreSQL), network-scoped Row Level Security                                                                                           |
| Smart contracts                    | Solidity 0.8.24 (EVM Cancun, optimizer 200 runs, via-ir), Foundry (Forge/Cast), OpenZeppelin Contracts v5                                                  |
| Blockchain                         | Robinhood Chain — testnet chain ID `46630`, mainnet chain ID `4663`                                                                                        |
| Monorepo tooling                   | Turborepo, pnpm workspaces, `concurrently` for local multi-service dev                                                                                     |
| Deployment                         | Railway (Docker builder) or Nixpacks; single `node:22-alpine` Docker image                                                                                 |

## 5. Database Schema (Supabase / Postgres)

Four migrations under `supabase/migrations/`, all tables carry a
`network VARCHAR(32) DEFAULT 'TESTNET'` column (dual TESTNET/MAINNET model).

### Core protocol tables (`20260915000001_init_schema.sql`, public read + service-role write RLS)

- `users` — wallet profiles, unique on `(network, wallet_address)`, ENS name.
- `markets` — isolated lending pairs: symbol, category, collateral/debt token,
  pair address, mark price, max LTV, liquidation LTV, max leverage, supply
  APY, borrow APR, TVL, liquidity, risk tier, status.
- `user_positions` — Long/Short/Multiply/Collateral positions: leverage,
  equity/exposure, collateral/debt amounts, entry/mark/liquidation price,
  health factor, PnL, status (ACTIVE/CLOSED/LIQUIDATED/PROTECTED).
- `vaults` — ERC-4626 vaults: address, APY, TVL, utilization, risk tier,
  JSONB allocation breakdown.
- `activity_logs` — on-chain action audit trail (DEPOSIT, BORROW, REPAY,
  WITHDRAW, OPEN_POSITION, AUTO_PROTECT_EXECUTED, LIQUIDATED), keyed by tx hash.
- `auto_protect_configs` — per-position keeper rules (trigger/target LTV,
  max deleverage), unique on `(network, user_address, position_id)`.

Follow-up migration `20260916000001_add_pair_address.sql` adds `pair_address`
to `markets` / `user_positions` and backfills 4 testnet pairs
(NVDA/AAPL/TSLA/SPY).

### Canonical RH ledger tables (`20260917000001_rh_canonical_lending.sql`)

Scoped to `chain_id = 46630`, append-only, strict hex-format `CHECK`
constraints, **all client privileges revoked** (backend-only, no anon/
authenticated access):

- `rh_lending_checkpoints` — per-pair indexer sync checkpoint.
- `rh_lending_batches` — indexed block-range batches (idempotency/reorg
  tracking).
- `rh_lending_events` — canonical event log (`deposit|withdraw|borrow|repay|
liquidation`), JSONB payload, PK `(chain_id, pair_address, tx_hash,
log_index)`.
- `rh_lending_accounts` — latest collateral/debt balances per user/pair.

### Pons tables (`20260918000001_pons_tokens_discovery.sql`)

- `pons_tokens` — token metadata, provenance, graduation status/phase,
  valuation, eligibility, unique `(chain_id, token_address)`.
- `pons_market_history` — time-series price/market-cap snapshots.

`supabase/seed.sql` seeds `markets` / `vaults` for both networks with mock
data for the 8 equity pairs and multiple vaults.

## 6. Smart Contracts (`packages/contracts/src/`)

| Category                         | Contracts                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Core                             | `core/LeveraPair.sol` (isolated lending engine per pair)                                                                                   |
| Registry                         | `registry/LeveraMarketRegistry.sol`                                                                                                        |
| Routers                          | `routers/LeveraRouter.sol`, `LeverageRouter.sol`, `ShortRouter.sol`                                                                        |
| Modules                          | `modules/AutoProtectModule.sol`, `PonsAutoProtectModule.sol`                                                                               |
| Vaults                           | `vaults/LeveraVault.sol` (ERC-4626)                                                                                                        |
| Oracle                           | `oracle/RhTestnetReferenceOracle.sol`, `VerifiedFeedOracle.sol`, `CompositeSanityOracle.sol`, `IDexTwapOracle.sol`, `PonsOracleRouter.sol` |
| Pons                             | `pons/PonsMarketAdapter.sol`, `PonsLeverageRegistry.sol`, `PonsRiskEngine.sol`                                                             |
| Margin trading (newer subsystem) | `trading/MarginRouter.sol`, `LeveragePositionManager.sol`, `RhShortReferenceOracle.sol`                                                    |
| Test tokens                      | `tokens/TestnetERC20.sol`                                                                                                                  |

Deploy scripts under `script/` (`DeployLevera.s.sol`, `DeployPons.s.sol`),
receipts under `deployments/`.

## 7. Deployment & Infra

- **Railway** (`railway.json`): Docker builder, restart `ON_FAILURE`, max 10
  retries.
- **Nixpacks** (`nixpacks.toml`): alternate build path — pnpm via corepack,
  start command `pnpm --filter=@levera/${SERVICE:-web} start`.
- **Dockerfile**: single multi-purpose image (`node:22-alpine`) for the whole
  monorepo.
    - `ARG SERVICE` selects what gets built (`all` by default, or a single
      filtered package).
    - Public-only build ARGs baked into `apps/web/.env` at build time
      (`NETWORK_MODE`, `CHAIN_ID`, `USDG_ADDRESS`, `PROTOCOL_ADDRESSES`,
      `TRADING_ENABLED`, etc.) — secrets (RPC/DB credentials) are runtime-only,
      never baked into the image.
    - `CMD`: if `SERVICE=backend`, runs `scripts/run-all-backend.mjs` (spawns
      API + indexer + price-oracle concurrently); otherwise starts the single
      filtered app.
    - This implies one Railway service per app (web, backend, keeper,
      price-oracle), all from the same image, started differently via
      `SERVICE`.
- Feature-gate flags (`TRADING_ENABLED`, `LENDING_ENABLED`,
  `MARGIN_TRADING_ENABLED`) currently kept false until explicit acceptance
  criteria are met (see §1).

## 8. External Integrations

- **Robinhood Chain RPC** — via Alchemy, proxied client-side through
  `/api/rpc` so provider URLs never reach the browser.
- **Robinhood quotes/stock API** — reference prices for tokenized equities.
- **Pyth Network (Hermes)** — price feeds.
- **Kraken** — USDG/USD reference price.
- **Supabase** — Postgres database + anon/service-role key access pattern,
  strict TLS via bundled CA cert.
- **Railway** — deploy target.

## 9. Ops Tooling (`scripts/`)

Large toolkit implementing a **prepare → simulate/plan → deploy →
verify/accept → status** lifecycle per capability:

- RH core lending pipeline (prepare, simulate, deploy modules, finalize,
  status checks).
- RH indexer (migrate/sync/serve/status against canonical `rh_lending_*`
  tables).
- RH price publisher (observe/serve, on-chain reference price publishing).
- RH margin trading (deploy/accept/check).
- RH market expansion — onboarding new tickers (preflight, prepare, plan,
  deploy, accept, enable, pause, gas reconciliation).
- RH mainnet-core — separate, stricter deploy path with gas budgeting and a
  deploy mutex (`scripts/lib/process-lock.mjs`).
- Pons indexer (migrate/sync/serve) reading the Pons V2 Factory on Robinhood
  Chain mainnet.
- Environment sanity checks (mainnet/testnet/local API).
- `security-check.mjs` — scans for secret values leaking into
  browser-exposed code.

## 10. Open Items for Rebrand

Not addressed by this document — tracked for the separate rebranding
development plan:

- `LEVERA` / `Levera` branding strings in README, docs, UI copy.
- Package names: root `levera-monorepo`, workspace packages `@levera/*`.
- Environment variable prefixes and JSON blob keys named `RH_*`,
  `LEVERA_*`-style (audit needed for exact prefix usage).
- Contract names (`LeveraPair`, `LeveraRouter`, `LeveraVault`,
  `LeveraMarketRegistry`, etc.) — renaming on-chain-facing names has
  redeployment implications since testnet contracts are already deployed.
- Database schema: no table names currently use the `levera` string
  directly (checked `supabase/migrations/`), so DB rename scope is limited
  to any application-level references, not schema itself.
- `data/*.json` config file naming and content.
