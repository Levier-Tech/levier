import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const isLiveSupabase = true;
export const supabase: SupabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
