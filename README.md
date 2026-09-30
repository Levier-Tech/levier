# LEVIER MARKETS

> **Leverage for tokenized assets on Robinhood Chain.**

Levier Markets is the credit and leverage layer built for tokenized assets (equities, ETFs, and RWAs) on [Robinhood Chain](https://explorer.testnet.chain.robinhood.com). It provides a modern brokerage margin experience — **Borrow, Earn, Long, Short, Multiply, Auto-Protect** — over isolated lending markets, with each tokenized asset operating in its own risk-isolated pair.

---

## Architecture Overview

```
User / Web3 Wallet
       │
       ▼
  LevierRouter ─────────────┐
       │                     │
       ├── LeverageRouter    │  (Atomic Long & Multiply)
       ├── ShortRouter       │  (Atomic Short)
       └── AutoProtectModule │  (Keeper Deleverage)
              │
              ▼
       LevierPair (Isolated Lending)
              │
              ▼
   RhTestnetReferenceOracle
              │
       LevierMarketRegistry (Risk Tiers A/B/C/Experimental)
              │
       LevierVault (ERC-4626 Yield)
```

---

## Current Status — RH Testnet (Chain 46630)

**Core deployment: COMPLETE.** 8 contracts deployed and verified on Robinhood Chain Testnet. Direct-pair lending lifecycle (deposit → borrow → repay → withdraw) has **PASSED** with real TSLA/USDG. Public-testnet trading remains **DISABLED** pending continuous oracle publishing and browser-wallet acceptance.

### Deployed Contracts

| Contract | Address | State |
| :--- | :--- | :--- |
| `LevierMarketRegistry` | [`0x41d7…fff3`](https://explorer.testnet.chain.robinhood.com/address/0x41d7f4c434de83d1602c5a0bd548d1b985c8fff3) | 1 registered market; owner verified |
| `LevierRouter` | [`0x23aa…6878`](https://explorer.testnet.chain.robinhood.com/address/0x23aa8e2c2025354553217f091f15ba1e1d5e6878) | Authorized in registry |
| `LeverageRouter` | [`0xf284…53d2`](https://explorer.testnet.chain.robinhood.com/address/0xf284f47c169774d303ac92d46c88598f82a453d2) | Paused; swaps/close incomplete |
| `ShortRouter` | [`0x8bea…e4ef`](https://explorer.testnet.chain.robinhood.com/address/0x8beabef1bc8a123abe915f088487c90e917de4ef) | Paused; reverse market incomplete |
| `AutoProtectModule` | [`0xe157…0365`](https://explorer.testnet.chain.robinhood.com/address/0xe1578ca2519b23bc5fad31d021e6e69736f60365) | Paused; deleveraging incomplete |
| `LevierVault` | [`0xfe8b…049e`](https://explorer.testnet.chain.robinhood.com/address/0xfe8bc5b71743a98c3864437ad86f8b8ab2ea049e) | Deposit/mint closed |
| `RhTestnetReferenceOracle` | [`0x8f0e…2ad4`](https://explorer.testnet.chain.robinhood.com/address/0x8f0e3da3941570c945a930092b2a721eddeb2ad4) | Real price publications |
| `LevierPair` (TSLA/USDG) | [`0x43b3…38aa`](https://explorer.testnet.chain.robinhood.com/address/0x43b3c72fa2e5b0b8ba8b610b7a39ce4c33ed38aa) | Lifecycle passed; paused |

Full record: [`packages/contracts/deployments/testnet-46630.json`](packages/contracts/deployments/testnet-46630.json).

### Remaining Work

- **OPS-01:** Continuous price publisher with health checks and source validation
- **OPS-02:** Browser-wallet acceptance for `/lending`
- **OPS-03:** Canonical event indexing with idempotency and reorg recovery
- **PRODUCT-01:** Long/Short swap execution and closing flows
- **PRODUCT-02:** Vault allocation/interest and AutoProtect collateral-funded execution
- **RELEASE-01:** Public exposure controls, rate limits, recovery runbooks

See [RH Testnet Status](docs/RH_TESTNET_STATUS.md) and [RH Core Deployment](docs/RH_CORE_DEPLOYMENT_COMPLETE.md) for full evidence.

---

## Product Features

- **Isolated Lending Markets:** Every tokenized asset (TSLA, AAPL, NVDA, SPY) operates in its own isolated pair to contain volatility and oracle risks.
- **1-Click Leverage (Long & Short):** Open 1.25x–2.5x leveraged positions without manual multi-step swaps or flash loans.
- **Auto-Protect Guard:** Offchain keeper service monitors account health and automatically deleverages at user-defined LTV thresholds before liquidation.
- **ERC-4626 Yield Vaults:** Deposit stablecoins into yield-bearing vaults that allocate across isolated lending markets.
- **RPC Privacy Shield:** All browser RPC traffic proxied through `/api/rpc`; provider credentials never exposed to DevTools.
- **Pure Backend API Gateway:** Frontend never directly connects to Supabase; all data flows through `apps/api`.
- **Zero-Fallback Policy:** Zod-validated environment variables with fail-fast on any missing configuration.

---

## Monorepo Structure

```text
levier/                                 # Monorepo root (Turborepo + pnpm)
├── data/                               # Static JSON configuration
│   ├── asset-catalog.json              # Asset names, icons & metadata
│   ├── tokens.json                     # Token metadata (per network)
│   ├── markets.json                    # Isolated pair parameters & risk tiers
│   └── vaults.json                     # ERC-4626 vault allocations
├── apps/
│   ├── web/                            # Next.js 14+ (App Router) — Dark theme UI
│   ├── api/                            # Express REST API (Supabase gateway)
│   ├── indexer/                        # EVM event indexer (Supabase sync)
│   ├── keeper/                         # Auto-Protect offchain worker bot
│   └── price-oracle/                   # Real-time price feed service
├── packages/
│   ├── contracts/                      # Foundry smart contracts (Solidity 0.8.24)
│   │   ├── src/                        # Contract source code
│   │   │   ├── core/                   # LevierPair (Isolated Lending Engine)
│   │   │   ├── registry/               # LevierMarketRegistry (Risk Tiers)
│   │   │   ├── routers/                # LevierRouter, LeverageRouter, ShortRouter
│   │   │   ├── modules/                # AutoProtectModule (Keeper Deleverage)
│   │   │   ├── vaults/                 # LevierVault (ERC-4626)
│   │   │   ├── oracle/                 # RhTestnetReferenceOracle
│   │   │   └── interfaces/             # Contract interfaces
│   │   ├── test/                       # Foundry unit & fuzz tests
│   │   ├── script/                     # Deployment scripts (Forge Script)
│   │   └── deployments/                # Deployment receipts & artifacts
│   └── types/                          # Shared TypeScript interfaces (@levier/types)
├── scripts/                            # Deployment & verification scripts
├── tests/                              # Integration & boundary tests
├── supabase/                           # PostgreSQL migrations & seed data
│   ├── migrations/
│   └── seed.sql
├── docs/                               # Deployment checkpoints & evidence
├── .env.example                        # ENV template (Zod-validated)
├── .env.testnet.example                # Testnet ENV template
├── .env.mainnet.example                # Mainnet ENV template
├── Dockerfile                          # pnpm monorepo container build
├── nixpacks.toml                       # Railway deployment config
├── railway.json                        # Railway service config
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## Smart Contract Architecture

```mermaid
graph TD
    User([User / Web3 Wallet]) -->|Approve & Interact| Router[LevierRouter.sol]
    Keeper([Keeper Bot]) -->|Trigger LTV Breach| AutoProtect[AutoProtectModule.sol]

    subgraph Execution Routers
        Router --> LeverageRouter[LeverageRouter.sol / Atomic Long & Multiply]
        Router --> ShortRouter[ShortRouter.sol / Atomic Short]
    end

    subgraph Core Lending & Registry
        Router --> Registry[LevierMarketRegistry.sol / Risk Tiers A,B,C]
        LeverageRouter --> Pairs[LevierPair.sol / Isolated Collateral & Debt]
        ShortRouter --> Pairs
        AutoProtect --> Pairs
    end

    subgraph Yield Vaults
        LP([Liquidity Provider]) --> Vault[LevierVault.sol / ERC-4626]
        Vault --> Pairs
    end

    subgraph Oracles & Risk
        Pairs --> Oracle[RhTestnetReferenceOracle.sol]
        Oracle --> RobinhoodFeed[Onchain Price Feed Adapter]
    end
```

### Core Contracts

| Contract | Role |
| :--- | :--- |
| **LevierMarketRegistry** | Stores supported markets with risk parameters: LLTV, oracle, caps, status, risk tier (`Tier A` / `Tier B` / `Tier C` / `Experimental`). Controls market add, pause, and configuration. |
| **LevierPair** | Isolated lending engine per asset pair. Handles collateral deposits, stablecoin borrowing, Max LTV checks, dynamic interest rate model, and on-chain liquidation with controlled penalties. |
| **LevierRouter** | Main user entry point. Routes supply/borrow/repay/withdraw actions with permit/transfer management in a single transaction. |
| **LeverageRouter** | Atomic multi-step execution for **Long** & **Multiply** positions (deposit → borrow → swap → re-supply) up to 2.5x with slippage protection and oracle sanity checks. |
| **ShortRouter** | Atomic short execution: deposit stablecoin collateral → borrow tokenized stock → sell for stablecoin to lock short position. |
| **AutoProtectModule** | Stores user-configured deleverage rules (`triggerLtv`, `targetLtv`, `maxDeleverage`). Keeper bots execute deleveraging only when LTV breach is proven on-chain. |
| **LevierVault** | ERC-4626 yield vault accepting stablecoin deposits and routing liquidity across isolated lending pairs for supplier APY. |
| **RhTestnetReferenceOracle** | Centralized testnet-only oracle with real reference prices (Robinhood TSLA quotes, Kraken USDG/USD). Immutable publisher/binding. Max age, deviation checks, and stale-data blocking. |

### Compiler & Toolchain

- **Solidity:** `0.8.24` (EVM: Cancun, Optimizer: 200 runs, via-ir enabled)
- **Framework:** Foundry (Forge & Cast)
- **Dependencies:** OpenZeppelin Contracts v5, forge-std
- **Tests:** Unit + fuzz tests (4 fuzz suites × 1000 runs), solvency invariants

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js 14+ (App Router), React 18, Tailwind CSS, Wagmi v3, Viem |
| **Backend API** | Express, TypeScript, Zod, Supabase Client |
| **Database** | Supabase (PostgreSQL) with network-scoped RLS |
| **Smart Contracts** | Solidity 0.8.24, Foundry (Forge), OpenZeppelin v5 |
| **Blockchain** | Robinhood Chain Testnet (Chain ID: 46630) |
| **Monorepo** | Turborepo, pnpm workspaces |
| **Deployment** | Railway (Docker / Nixpacks) |

---

## Getting Started

### Prerequisites

- **Node.js:** `>= 22.0.0`
- **Package Manager:** `pnpm >= 9.0.0`
- **Smart Contract Tooling:** `Foundry` (Forge & Cast)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Levier-Tech/levier.git
   ```

2. Install workspace dependencies:
   ```bash
   pnpm install
   ```

3. Setup environment variables:
   ```bash
   cp .env.testnet.example .env
   ```
   Fill in your RPC URL, Supabase credentials, wallet keys and contract addresses. All variables are Zod-validated — missing keys trigger a fail-fast error.

4. Start the development servers (web + API):
   ```bash
   pnpm dev:core
   ```
   Open [http://localhost:3002](http://localhost:3002) to view the application.

5. Start all services (web + API + indexer + keeper + price-oracle):
   ```bash
   pnpm dev
   ```

6. Verify production build:
   ```bash
   pnpm run build
   ```

### Smart Contract Development

```bash
# Build contracts
pnpm --filter @levier/contracts build

# Run tests (including fuzz tests)
pnpm --filter @levier/contracts test

# Generate lending ABIs
pnpm generate:lending-abis
```

---

## Available Scripts

| Script | Description |
| :--- | :--- |
| `pnpm dev` | Start all workspace services |
| `pnpm dev:core` | Start web + API only |
| `pnpm build` | Build all packages (excluding contracts) |
| `pnpm build:all` | Build everything including contracts |
| `pnpm lint` | Run TypeScript type-checking |
| `pnpm format` | Format code with Prettier |
| `pnpm test:web-boundaries` | Run web boundary tests |
| `pnpm test:lending-client` | Run lending client tests |
| `pnpm security:check` | Scan for leaked secrets |
| `pnpm check:preparation` | Verify RH deployment preparation |
| `pnpm check:assets` | Verify RH testnet asset balances |
| `pnpm generate:lending-abis` | Generate ABIs from Foundry artifacts |

---

## Environment Variables & Security

Levier enforces a strict **Zero-Fallback Policy** using **Zod** schema validation. Missing required keys trigger a fail-fast runtime termination. Credentials never appear in browser bundles or logs.

### Key Variables

```env
# Network
NETWORK_MODE=TESTNET
CHAIN_ID=46630
RPC_URL=https://robinhood-testnet.g.alchemy.com/v2/your-key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

# Backend
BACKEND_API_URL=http://localhost:3001

# Execution gates (keep false until acceptance)
TRADING_ENABLED=false
LENDING_ENABLED=false
```

See [`.env.example`](.env.example) and [`.env.testnet.example`](.env.testnet.example) for the full template.

---

## Engineering Principles

### 🧹 Clean Code & Clean Architecture

All code, variable names, function names, types, interfaces and documentation are written in **English**. Zero tolerance for code smells, bloated components, duplicate code, or tight coupling. Every module follows **SOLID principles** and **DRY**. Components are focused, reusable and well-separated by concern.

### 🚫 Zero-Fallback & Zero Mock Data Policy

All environment variables are validated at startup using **Zod** schema (via `@t3-oss/env-nextjs`). Missing or invalid keys trigger an immediate **fail-fast termination** — no silent fallbacks.

```
❌ Forbidden:  process.env.RPC_URL || 'http://localhost:8545'
❌ Forbidden:  process.env.A || process.env.NEXT_PUBLIC_A || 'fallback'
✅ Required:   Zod-validated, explicit fail on missing key
```

UI components never hardcode market lists, token metadata or financial data. All static configuration lives in structured JSON files inside `data/` (`markets.json`, `tokens.json`, `vaults.json`, `asset-catalog.json`). Backend services fail-fast (HTTP 503) when Supabase or price feeds are unavailable — never substituting mock/dummy data.

### 🔀 Dual Network Mode (TESTNET / MAINNET)

Controlled via `NETWORK_MODE` environment variable. Every Supabase table includes a `network VARCHAR NOT NULL DEFAULT 'TESTNET'` column. All services (web, API, indexer, keeper) filter and display data exclusively for the active network mode. A single wallet has separate profiles and history between TESTNET and MAINNET via `(network, wallet_address)` unique constraint.

### 🏛️ Pure Backend API Gateway

The frontend (`apps/web`) **never** directly connects to Supabase or imports `@supabase/supabase-js` in the client bundle. All database reads and writes pass through `apps/api` via internal Next.js rewrites (`/api/v1/*`). This completely eliminates:

- Database schema leakage to browsers
- API key exposure in client bundles
- Direct database connections from user devices

### 🛡️ RPC Privacy Shield

Node RPC URLs and API keys (e.g., Alchemy) are **never** exposed in the browser's DevTools Network inspector. Wagmi transports in the web client point to the relative endpoint `/api/rpc`. The Next.js server-side route handler proxies JSON-RPC payloads to `process.env.RPC_URL`, completely shielding provider endpoints from client inspection.

### ⚡ Database & Egress Optimization

Strict resource preservation for Supabase Free Tier (2 GB/month egress):

- **Server-side TTL caching** on high-frequency API routes (`/markets` 10s, `/vaults` 30s, `/liquidations/*` 15s) — reducing Supabase queries by > 95%
- **Tab-visibility aware polling** (`useSmartPolling`) — automatically freezes background HTTP requests when the browser tab is hidden and refreshes immediately upon focus return
- **Composite indexes** on `(network, user_address)` and `(network, market_id)` for < 50ms query response

---

## Documentation

| Document | Description |
| :--- | :--- |
| [`brief/levier_development.md`](../brief/levier_development.md) | Product & engineering brief |
| [`brief/levier_roadmap.md`](../brief/levier_roadmap.md) | Phase-by-phase development roadmap |
| [`docs/RH_TESTNET_STATUS.md`](docs/RH_TESTNET_STATUS.md) | Current testnet status & verification commands |
| [`docs/RH_CORE_DEPLOYMENT_COMPLETE.md`](docs/RH_CORE_DEPLOYMENT_COMPLETE.md) | Core deployment completion report |
| [`docs/RH_ORACLE_CHECKPOINT.md`](docs/RH_ORACLE_CHECKPOINT.md) | Oracle integration checkpoint |
| [`docs/RH_LENDING_CLIENT_CHECKPOINT.md`](docs/RH_LENDING_CLIENT_CHECKPOINT.md) | Lending client implementation checkpoint |

---

## License

Copyright &copy; 2026 Levier Markets. All rights reserved.
