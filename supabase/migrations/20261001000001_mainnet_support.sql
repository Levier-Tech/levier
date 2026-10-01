-- =============================================================================
-- Migration: Robinhood Chain mainnet support and write lockdown
-- Date: 2026-10-01
-- 1. RH canonical lending tables accept mainnet (4663) as well as testnet (46630).
-- 2. Table writes are limited to the service role. The previous "Service Role All"
--    policies applied to every role, so any holder of the public anon key could
--    insert, update or delete rows. The API and keeper write with
--    SUPABASE_SERVICE_ROLE_KEY instead.
-- 3. Pons tables get RLS with public read only.
-- =============================================================================

-- 1. Chain scope of the canonical lending tables
ALTER TABLE public.rh_lending_checkpoints DROP CONSTRAINT IF EXISTS rh_lending_checkpoints_chain_id_check;
ALTER TABLE public.rh_lending_checkpoints ADD CONSTRAINT rh_lending_checkpoints_chain_id_check CHECK (chain_id IN (46630, 4663));
ALTER TABLE public.rh_lending_batches DROP CONSTRAINT IF EXISTS rh_lending_batches_chain_id_check;
ALTER TABLE public.rh_lending_batches ADD CONSTRAINT rh_lending_batches_chain_id_check CHECK (chain_id IN (46630, 4663));
ALTER TABLE public.rh_lending_events DROP CONSTRAINT IF EXISTS rh_lending_events_chain_id_check;
ALTER TABLE public.rh_lending_events ADD CONSTRAINT rh_lending_events_chain_id_check CHECK (chain_id IN (46630, 4663));
ALTER TABLE public.rh_lending_accounts DROP CONSTRAINT IF EXISTS rh_lending_accounts_chain_id_check;
ALTER TABLE public.rh_lending_accounts ADD CONSTRAINT rh_lending_accounts_chain_id_check CHECK (chain_id IN (46630, 4663));

-- 2. Writes for the service role only
DROP POLICY IF EXISTS "Service Role All Users" ON users;
DROP POLICY IF EXISTS "Service Role All Markets" ON markets;
DROP POLICY IF EXISTS "Service Role All User Positions" ON user_positions;
DROP POLICY IF EXISTS "Service Role All Vaults" ON vaults;
DROP POLICY IF EXISTS "Service Role All Activity Logs" ON activity_logs;
DROP POLICY IF EXISTS "Service Role All Auto Protect" ON auto_protect_configs;
CREATE POLICY "Service Role All Users" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Markets" ON markets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All User Positions" ON user_positions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Vaults" ON vaults FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Activity Logs" ON activity_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service Role All Auto Protect" ON auto_protect_configs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Pons tables: public read, service-role writes
ALTER TABLE public.pons_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pons_market_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Pons Tokens" ON public.pons_tokens;
DROP POLICY IF EXISTS "Public Read Pons Market History" ON public.pons_market_history;
CREATE POLICY "Public Read Pons Tokens" ON public.pons_tokens FOR SELECT USING (true);
CREATE POLICY "Public Read Pons Market History" ON public.pons_market_history FOR SELECT USING (true);
