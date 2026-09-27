import { Router, Request, Response } from 'express';
import { supabase, isLiveSupabase } from '../supabase.js';
import { VaultConfig, NetworkMode } from '@levera/types';
import { apiCache } from '../utils/cache.js';

export const vaultsRouter = Router();

// GET /api/v1/vaults?network=TESTNET
vaultsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const network = ((req.query.network as string) || 'TESTNET').toUpperCase() as NetworkMode;
    const cacheKey = `vaults:${network}`;

    const cached = apiCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    const { data, error } = await supabase.from('vaults').select('*').eq('network', network);
    if (error) throw error;

    const responsePayload = { success: true, network, count: data?.length || 0, data };
    apiCache.set(cacheKey, responsePayload, 30);
    return res.json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

