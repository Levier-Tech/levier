import { Router, Request, Response } from 'express';
import { supabase, isLiveSupabase } from '../supabase.js';
import { NetworkMode } from '@levera/types';

export const activityRouter = Router();

// GET /api/v1/activity?network=TESTNET&userAddress=0x...
activityRouter.get('/', async (req: Request, res: Response) => {
  try {
    const network = ((req.query.network as string) || 'TESTNET').toUpperCase() as NetworkMode;
    const userAddress = req.query.userAddress as string | undefined;

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    let query = supabase.from('activity_logs').select('*').eq('network', network).order('timestamp', { ascending: false });
    if (userAddress) {
      query = query.eq('user_address', userAddress.toLowerCase());
    }
    const { data, error } = await query.limit(50);
    if (error) throw error;
    return res.json({ success: true, network, count: data?.length || 0, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
