-- =============================================================================
-- LEVIER MARKETS DATABASE SEED SCRIPT
-- Imports initial markets, vaults, and seed positions for TESTNET & MAINNET
-- Monorepo Specification: Phase 2 (Task 2.2)
-- =============================================================================

-- Clean existing data
TRUNCATE TABLE auto_protect_configs, activity_logs, user_positions, vaults, markets CASCADE;

-- -----------------------------------------------------------------------------
-- 1. SEED MARKETS (TESTNET)
-- -----------------------------------------------------------------------------
INSERT INTO markets (
    slug, network, asset_symbol, name, category, collateral_token, debt_token, pair_address,
    mark_price, max_ltv, liquidation_ltv, max_leverage, supply_apy, borrow_apr,
    total_supply_usd, total_borrow_usd, available_liquidity_usd, risk_tier, status
) VALUES
('nvda-usdg-testnet', 'TESTNET', 'NVDA', 'NVIDIA / USDG', 'Equities', 'NVDA', 'USDG', '0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0', 250.00, 60.0, 70.0, 2.5, 5.80, 8.20, 1400000.00, 740000.00, 660000.00, 'Tier A', 'NORMAL'),
('aapl-usdg-testnet', 'TESTNET', 'AAPL', 'Apple / USDG', 'Equities', 'AAPL', 'USDG', '0x9a676e781a523b5d0c0e43731313a708cb607508', 230.50, 60.0, 70.0, 2.5, 4.90, 7.40, 920000.00, 410000.00, 510000.00, 'Tier A', 'NORMAL'),
('tsla-usdg-testnet', 'TESTNET', 'TSLA', 'Tesla / USDG', 'Equities', 'TSLA', 'USDG', '0x959922be3caee4b8cd9a407cc3ac1c251c2007b1', 215.80, 50.0, 60.0, 2.0, 7.20, 10.10, 810000.00, 500000.00, 310000.00, 'Tier B', 'NORMAL'),
('spy-usdg-testnet', 'TESTNET', 'SPY', 'SPDR S&P 500 / USDG', 'ETFs', 'SPY', 'USDG', '0x68b1d87f95878fe05b998f19b66f4baba5de1aed', 560.20, 70.0, 80.0, 2.5, 3.80, 6.10, 2100000.00, 980000.00, 1120000.00, 'Tier A', 'NORMAL'),
('meta-usdg-testnet', 'TESTNET', 'META', 'Meta Platforms / USDG', 'Equities', 'META', 'USDG', '0x0000000000000000000000000000000000000000', 510.40, 55.0, 65.0, 2.0, 6.10, 8.90, 680000.00, 320000.00, 360000.00, 'Tier B', 'NORMAL'),
('amzn-usdg-testnet', 'TESTNET', 'AMZN', 'Amazon.com / USDG', 'Equities', 'AMZN', 'USDG', '0x0000000000000000000000000000000000000000', 185.30, 60.0, 70.0, 2.5, 5.10, 7.80, 750000.00, 380000.00, 370000.00, 'Tier A', 'NORMAL'),
('msft-usdg-testnet', 'TESTNET', 'MSFT', 'Microsoft / USDG', 'Equities', 'MSFT', 'USDG', '0x2279b1c602d95b0d0f7f19979dd6570c92170abc', 425.50, 60.0, 70.0, 2.5, 5.20, 7.60, 1200000.00, 550000.00, 650000.00, 'Tier A', 'NORMAL'),
('googl-usdg-testnet', 'TESTNET', 'GOOGL', 'Alphabet / USDG', 'Equities', 'GOOGL', 'USDG', '0x8a791620dd6260079bf849dc5567adc3f2fdc318', 178.50, 60.0, 70.0, 2.5, 5.30, 7.70, 950000.00, 420000.00, 530000.00, 'Tier A', 'NORMAL');

-- -----------------------------------------------------------------------------
-- 2. SEED MARKETS (MAINNET)
-- -----------------------------------------------------------------------------
INSERT INTO markets (
    slug, network, asset_symbol, name, category, collateral_token, debt_token, pair_address,
    mark_price, max_ltv, liquidation_ltv, max_leverage, supply_apy, borrow_apr,
    total_supply_usd, total_borrow_usd, available_liquidity_usd, risk_tier, status
) VALUES
('nvda-usdg-mainnet', 'MAINNET', 'NVDA', 'NVIDIA / USDG', 'Equities', 'NVDA', 'USDG', '0x0000000000000000000000000000000000000000', 250.00, 60.0, 70.0, 2.5, 6.20, 8.80, 18500000.00, 9200000.00, 9300000.00, 'Tier A', 'NORMAL'),
('aapl-usdg-mainnet', 'MAINNET', 'AAPL', 'Apple / USDG', 'Equities', 'AAPL', 'USDG', '0x0000000000000000000000000000000000000000', 230.50, 60.0, 70.0, 2.5, 5.40, 7.90, 12400000.00, 5800000.00, 6600000.00, 'Tier A', 'NORMAL'),
('tsla-usdg-mainnet', 'MAINNET', 'TSLA', 'Tesla / USDG', 'Equities', 'TSLA', 'USDG', '0x0000000000000000000000000000000000000000', 215.80, 50.0, 60.0, 2.0, 8.10, 11.20, 9800000.00, 6100000.00, 3700000.00, 'Tier B', 'NORMAL'),
('spy-usdg-mainnet', 'MAINNET', 'SPY', 'SPDR S&P 500 / USDG', 'ETFs', 'SPY', 'USDG', '0x0000000000000000000000000000000000000000', 560.20, 70.0, 80.0, 2.5, 4.20, 6.70, 28000000.00, 14200000.00, 13800000.00, 'Tier A', 'NORMAL'),
('msft-usdg-mainnet', 'MAINNET', 'MSFT', 'Microsoft / USDG', 'Equities', 'MSFT', 'USDG', '0x0000000000000000000000000000000000000000', 425.50, 60.0, 70.0, 2.5, 5.50, 7.80, 15000000.00, 7200000.00, 7800000.00, 'Tier A', 'NORMAL'),
('googl-usdg-mainnet', 'MAINNET', 'GOOGL', 'Alphabet / USDG', 'Equities', 'GOOGL', 'USDG', '0x0000000000000000000000000000000000000000', 178.50, 60.0, 70.0, 2.5, 5.60, 7.90, 11000000.00, 5100000.00, 5900000.00, 'Tier A', 'NORMAL');


-- -----------------------------------------------------------------------------
-- 3. SEED VAULTS (TESTNET & MAINNET)
-- -----------------------------------------------------------------------------
INSERT INTO vaults (
    slug, network, vault_address, name, symbol, asset_symbol,
    apy, tvl_usd, utilization_rate, risk_tier, allocations
) VALUES
(
    'levier-usdg-vault-testnet', 'TESTNET', '0x1111111111111111111111111111111111111111',
    'Levier USDG Yield Vault', 'lvUSDG', 'USDG', 7.15, 4850000.00, 78.4, 'Conservative',
    '[{"symbol":"NVDA","weightPercent":25},{"symbol":"AAPL","weightPercent":20},{"symbol":"META","weightPercent":15},{"symbol":"AMZN","weightPercent":15},{"symbol":"WETH","weightPercent":15},{"symbol":"Cash Reserve","weightPercent":10}]'::jsonb
),
(
    'levier-usd-vault-testnet', 'TESTNET', '0x2222222222222222222222222222222222222222',
    'Levier USDC Vault', 'lvUSD', 'USDC', 6.85, 3660000.00, 74.2, 'Conservative',
    '[{"symbol":"NVDA","weightPercent":30},{"symbol":"AAPL","weightPercent":25},{"symbol":"SPY","weightPercent":25},{"symbol":"TSLA","weightPercent":10},{"symbol":"Cash Reserve","weightPercent":10}]'::jsonb
),
(
    'levier-usdg-vault-mainnet', 'MAINNET', '0x3333333333333333333333333333333333333333',
    'Levier USDG Yield Vault', 'lvUSDG', 'USDG', 7.80, 32100000.00, 84.2, 'Conservative',
    '[{"symbol":"NVDA","weightPercent":30},{"symbol":"AAPL","weightPercent":25},{"symbol":"META","weightPercent":20},{"symbol":"AMZN","weightPercent":15},{"symbol":"Cash Reserve","weightPercent":10}]'::jsonb
);

-- -----------------------------------------------------------------------------
-- 4. NO SEED DEMO DATA
-- Demo user positions and activity logs have been removed for real data mode.
-- -----------------------------------------------------------------------------
