-- =============================================================================
-- Migration: Add pair_address to markets and user_positions
-- Date: 2026-09-16
-- Purpose: Remove hardcoded pair mappings from keeper daemon and use relational DB
-- =============================================================================

-- 1. Add pair_address column to markets table
ALTER TABLE markets ADD COLUMN IF NOT EXISTS pair_address VARCHAR(64);

-- 2. Add pair_address column to user_positions table (for direct indexing/audit)
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS pair_address VARCHAR(64);

-- 3. Populate Testnet Pair Addresses
UPDATE markets SET pair_address = '0xa51c1fc2f0d1a1b8494ed1fe312d7c3a78ed91c0' WHERE slug = 'nvda-usdg-testnet';
UPDATE markets SET pair_address = '0x9a676e781a523b5d0c0e43731313a708cb607508' WHERE slug = 'aapl-usdg-testnet';
UPDATE markets SET pair_address = '0x959922be3caee4b8cd9a407cc3ac1c251c2007b1' WHERE slug = 'tsla-usdg-testnet';
UPDATE markets SET pair_address = '0x68b1d87f95878fe05b998f19b66f4baba5de1aed' WHERE slug = 'spy-usdg-testnet';

-- 4. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_markets_pair_address ON markets(pair_address);
CREATE INDEX IF NOT EXISTS idx_user_positions_pair_address ON user_positions(pair_address);
