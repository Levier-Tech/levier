-- =============================================================================
-- LEVIER MARKETS DATABASE SCHEMA INITIALIZATION
-- Target Database: PostgreSQL (Supabase)
-- Monorepo Specification: Phase 2 (Task 2.1)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 0. USERS TABLE (Web3 Wallet Users & Network-Scoped Profiles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    wallet_address VARCHAR(64) NOT NULL,
    ens_name VARCHAR(128),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_network_wallet UNIQUE (network, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_users_network_wallet ON users(network, wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(network, last_login_at DESC);

-- -----------------------------------------------------------------------------
-- 1. MARKETS TABLE (Isolated Credit & Leverage Pairs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS markets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(128) UNIQUE NOT NULL,
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    asset_symbol VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL DEFAULT 'Equities',
    collateral_token VARCHAR(64) NOT NULL,
    debt_token VARCHAR(64) NOT NULL,
    pair_address VARCHAR(64),
    mark_price NUMERIC(18, 4) NOT NULL,
    max_ltv NUMERIC(8, 2) NOT NULL,
    liquidation_ltv NUMERIC(8, 2) NOT NULL,
    max_leverage NUMERIC(8, 2) NOT NULL DEFAULT 2.5,
    supply_apy NUMERIC(8, 2) NOT NULL DEFAULT 0,
    borrow_apr NUMERIC(8, 2) NOT NULL DEFAULT 0,
    total_supply_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_borrow_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    available_liquidity_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    risk_tier VARCHAR(32) NOT NULL DEFAULT 'Tier A',
    status VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast market lookups
CREATE INDEX IF NOT EXISTS idx_markets_network ON markets(network);
CREATE INDEX IF NOT EXISTS idx_markets_network_symbol ON markets(network, asset_symbol);
CREATE INDEX IF NOT EXISTS idx_markets_network_category ON markets(network, category);

-- -----------------------------------------------------------------------------
-- 2. USER POSITIONS TABLE (Active Credit, Long, Short & Multiply Positions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_positions (
    id VARCHAR(128) PRIMARY KEY,
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    user_address VARCHAR(64) NOT NULL,
    market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    asset_symbol VARCHAR(32) NOT NULL,
    pair_address VARCHAR(64),
    position_type VARCHAR(32) NOT NULL, -- 'LONG', 'SHORT', 'MULTIPLY', 'COLLATERAL'
    leverage NUMERIC(8, 2) NOT NULL DEFAULT 1.0,
    equity_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    exposure_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    collateral_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    debt_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    entry_price NUMERIC(18, 4) NOT NULL,
    mark_price NUMERIC(18, 4) NOT NULL,
    liquidation_price NUMERIC(18, 4) NOT NULL,
    health_factor NUMERIC(8, 2) NOT NULL DEFAULT 999.0,
    pnl_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    pnl_percent NUMERIC(8, 2) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'CLOSED', 'LIQUIDATED', 'PROTECTED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast composite indexes (<50ms target)
CREATE INDEX IF NOT EXISTS idx_user_positions_network_user ON user_positions(network, user_address);
CREATE INDEX IF NOT EXISTS idx_user_positions_network_market ON user_positions(network, market_id);
CREATE INDEX IF NOT EXISTS idx_user_positions_health ON user_positions(network, status, health_factor);

-- -----------------------------------------------------------------------------
-- 3. VAULTS TABLE (ERC-4626 Stablecoin Yield Vaults)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vaults (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(128) UNIQUE NOT NULL,
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    vault_address VARCHAR(64) NOT NULL,
    name VARCHAR(128) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    asset_symbol VARCHAR(32) NOT NULL,
    apy NUMERIC(8, 2) NOT NULL DEFAULT 0,
    tvl_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    utilization_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
    risk_tier VARCHAR(32) NOT NULL DEFAULT 'Conservative',
    allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vaults_network ON vaults(network);

-- -----------------------------------------------------------------------------
-- 4. ACTIVITY LOGS TABLE (Protocol & User Action Auditing)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    tx_hash VARCHAR(128) NOT NULL,
    user_address VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL, -- 'DEPOSIT', 'BORROW', 'REPAY', 'WITHDRAW', 'OPEN_POSITION', 'AUTO_PROTECT_EXECUTED', 'LIQUIDATED'
    asset_symbol VARCHAR(32) NOT NULL,
    amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    amount_usd NUMERIC(18, 2) NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_network_user ON activity_logs(network, user_address);
CREATE INDEX IF NOT EXISTS idx_activity_logs_network_time ON activity_logs(network, timestamp DESC);

-- -----------------------------------------------------------------------------
-- 5. AUTO-PROTECT CONFIGS TABLE (Keeper Risk Safeguards)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auto_protect_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network VARCHAR(32) NOT NULL DEFAULT 'TESTNET',
    user_address VARCHAR(64) NOT NULL,
    position_id VARCHAR(128) REFERENCES user_positions(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    trigger_ltv NUMERIC(8, 2) NOT NULL DEFAULT 55.0,
    target_ltv NUMERIC(8, 2) NOT NULL DEFAULT 40.0,
    max_deleverage NUMERIC(18, 2) NOT NULL DEFAULT 10000.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_position_protect UNIQUE (network, user_address, position_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_protect_network_user ON auto_protect_configs(network, user_address);
CREATE INDEX IF NOT EXISTS idx_auto_protect_enabled ON auto_protect_configs(network, is_enabled);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_protect_configs ENABLE ROW LEVEL SECURITY;

-- Public Read Policies (Allow all visitors to query data by network)
CREATE POLICY "Public Read Users" ON users FOR SELECT USING (true);
CREATE POLICY "Public Read Markets" ON markets FOR SELECT USING (true);
CREATE POLICY "Public Read User Positions" ON user_positions FOR SELECT USING (true);
CREATE POLICY "Public Read Vaults" ON vaults FOR SELECT USING (true);
CREATE POLICY "Public Read Activity Logs" ON activity_logs FOR SELECT USING (true);
CREATE POLICY "Public Read Auto Protect" ON auto_protect_configs FOR SELECT USING (true);

-- Service Role Policies (Allow backend services & indexers full insert/update privileges)
CREATE POLICY "Service Role All Users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Markets" ON markets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All User Positions" ON user_positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Vaults" ON vaults FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Activity Logs" ON activity_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Auto Protect" ON auto_protect_configs FOR ALL USING (true) WITH CHECK (true);
