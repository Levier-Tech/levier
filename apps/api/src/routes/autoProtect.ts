import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase, isLiveSupabase } from '../supabase.js';
import { NetworkMode } from '@levier/types';

export const autoProtectRouter = Router();

const autoProtectSchema = z.object({
  network: z.enum(['TESTNET', 'MAINNET']).default('TESTNET'),
  userAddress: z.string().min(10),
  positionId: z.string().optional(),
  isEnabled: z.boolean(),
  triggerLtv: z.number().min(30).max(95),
  targetLtv: z.number().min(20).max(85),
  maxDeleverage: z.number().positive(),
});

// GET /api/v1/auto-protect/:address?network=TESTNET
autoProtectRouter.get('/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address.toLowerCase();
    const network = ((req.query.network as string) || 'TESTNET').toUpperCase() as NetworkMode;

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    const { data, error } = await supabase
      .from('auto_protect_configs')
      .select('*')
      .eq('user_address', address)
      .eq('network', network);

    if (error) throw error;
    return res.json({ success: true, network, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/auto-protect
autoProtectRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = autoProtectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.format(),
      });
    }

    const payload = parsed.data;

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    const userAddress = payload.userAddress.toLowerCase();

    if (payload.positionId) {
      const { data, error } = await supabase.from('auto_protect_configs').upsert(
        {
          network: payload.network,
          user_address: userAddress,
          position_id: payload.positionId,
          is_enabled: payload.isEnabled,
          trigger_ltv: payload.triggerLtv,
          target_ltv: payload.targetLtv,
          max_deleverage: payload.maxDeleverage,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'network,user_address,position_id' }
      );
      if (error) throw error;
      return res.json({ success: true, message: 'Auto-protect rule updated successfully', data });
    } else {
      // Account-level rule (position_id is null)
      const { data: existing } = await supabase
        .from('auto_protect_configs')
        .select('id')
        .eq('network', payload.network)
        .eq('user_address', userAddress)
        .is('position_id', null)
        .maybeSingle();

      if (existing?.id) {
        const { data, error } = await supabase
          .from('auto_protect_configs')
          .update({
            is_enabled: payload.isEnabled,
            trigger_ltv: payload.triggerLtv,
            target_ltv: payload.targetLtv,
            max_deleverage: payload.maxDeleverage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (error) throw error;
        return res.json({ success: true, message: 'Auto-protect rule updated successfully', data });
      } else {
        const { data, error } = await supabase.from('auto_protect_configs').insert({
          network: payload.network,
          user_address: userAddress,
          position_id: null,
          is_enabled: payload.isEnabled,
          trigger_ltv: payload.triggerLtv,
          target_ltv: payload.targetLtv,
          max_deleverage: payload.maxDeleverage,
        });
        if (error) throw error;
        return res.json({ success: true, message: 'Auto-protect rule created successfully', data });
      }
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
