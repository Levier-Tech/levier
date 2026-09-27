-- 20260918000001_pons_tokens_discovery.sql

DROP TABLE IF EXISTS pons_market_history;
DROP TABLE IF EXISTS pons_tokens;

CREATE TABLE pons_tokens (
    id BIGSERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    
    -- Visual / UI Info
    name TEXT,
    symbol TEXT,
    logo_url TEXT,
    description TEXT,
    website_url TEXT,
    twitter_url TEXT,
    telegram_url TEXT,
    discord_url TEXT,
    
    -- Provenance & Graduation
    pons_generation TEXT NOT NULL,
    factory_address TEXT NOT NULL,
    pons_verified BOOLEAN NOT NULL DEFAULT FALSE,
    graduation_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    graduation_phase INTEGER,
    
    -- Current Valuation
    token_price_usd NUMERIC,
    circulating_supply NUMERIC,
    market_cap_usd NUMERIC,
    fdv_usd NUMERIC,
    
    -- Eligibility & Metadata
    eligible BOOLEAN NOT NULL DEFAULT FALSE,
    market_data_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(chain_id, token_address)
);

CREATE INDEX idx_pons_tokens_eligible ON pons_tokens(eligible);
CREATE INDEX idx_pons_tokens_market_cap ON pons_tokens(market_cap_usd DESC);
CREATE INDEX idx_pons_tokens_generation ON pons_tokens(pons_generation);
CREATE INDEX idx_pons_tokens_graduation ON pons_tokens(graduation_status);


CREATE TABLE pons_market_history (
    id BIGSERIAL PRIMARY KEY,
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    
    -- Snapshot Data
    price_usd NUMERIC NOT NULL,
    market_cap_usd NUMERIC NOT NULL,
    
    -- Record Time
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index to speed up history queries by time
CREATE INDEX idx_pons_history_token_time 
ON pons_market_history(token_address, recorded_at DESC);
