import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase, isLiveSupabase } from '../supabase.js';
import { NetworkMode } from '@levier/types';
import { apiCache } from '../utils/cache.js';

export const positionsRouter = Router();

const createPositionSchema = z.object({
  id: z.string().optional(),
  network: z.enum(['TESTNET', 'MAINNET']).default('TESTNET'),
  userAddress: z.string().min(10),
  marketId: z.string().optional(),
  assetSymbol: z.string().min(1),
  pairAddress: z.string().min(10),
  positionType: z.enum(['LONG', 'SHORT', 'MULTIPLY']),
  leverage: z.number().positive(),
  equityUsd: z.number().positive(),
  exposureUsd: z.number().positive(),
  collateralAmount: z.number().positive(),
  debtAmount: z.number().nonnegative(),
  entryPrice: z.number().positive(),
  markPrice: z.number().positive().optional(),
  liquidationPrice: z.number().nonnegative().optional(),
  healthFactor: z.number().nonnegative().optional(),
  txHash: z.string().optional(),
});

const closePositionSchema = z.object({
  userAddress: z.string().optional(),
  txHash: z.string().optional(),
  network: z.enum(['TESTNET', 'MAINNET']).default('TESTNET'),
});

// GET /api/v1/positions/:address?network=TESTNET&status=ACTIVE
positionsRouter.get('/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address.toLowerCase();
    const network = ((req.query.network as string) || 'TESTNET').toUpperCase() as NetworkMode;
    const statusParam = req.query.status as string | undefined;

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    let query = supabase
      .from('user_positions')
      .select('*')
      .eq('user_address', address)
      .eq('network', network);

    if (statusParam && statusParam.toUpperCase() !== 'ALL') {
      const statuses = statusParam.split(',').map((s) => s.trim().toUpperCase());
      query = query.in('status', statuses);
    } else if (!statusParam) {
      query = query.in('status', ['ACTIVE', 'OPEN']);
    }

    const { data, error } = await query;

    if (error) throw error;
    return res.json({ success: true, network, address, count: data?.length || 0, data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/positions
positionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createPositionSchema.safeParse(req.body);
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

    // 1. Resolve market_id and liquidation_ltv if not provided
    let marketId = payload.marketId;
    let liquidationLtv = 85;

    if (!marketId) {
      const { data: market } = await supabase
        .from('markets')
        .select('id, liquidation_ltv')
        .eq('network', payload.network)
        .eq('asset_symbol', payload.assetSymbol)
        .maybeSingle();

      if (market) {
        marketId = market.id;
        liquidationLtv = Number(market.liquidation_ltv || 85);
      }
    }

    const liqLtvFraction = liquidationLtv / 100;
    const entryPrice = payload.entryPrice;
    const markPrice = payload.markPrice ?? entryPrice;

    // Calculate liquidation price if not provided
    let liquidationPrice = payload.liquidationPrice;
    if (liquidationPrice === undefined || liquidationPrice === null) {
      if (payload.positionType === 'SHORT') {
        liquidationPrice = entryPrice * (1 + (payload.collateralAmount / payload.exposureUsd) * 0.7);
      } else {
        liquidationPrice = Math.max(
          0,
          entryPrice * (1 - (payload.collateralAmount / payload.exposureUsd) * (1 / liqLtvFraction) * 0.7)
        );
      }
    }

    // Calculate health factor if not provided
    let healthFactor = payload.healthFactor;
    if (healthFactor === undefined || healthFactor === null) {
      healthFactor =
        payload.debtAmount > 0
          ? Number(((payload.exposureUsd * liqLtvFraction) / payload.debtAmount).toFixed(2))
          : 999.0;
    }

    const positionId = payload.id || `pos-${Date.now()}-${userAddress.slice(2, 8)}`;

    // 2. Insert into user_positions
    const { data: positionData, error: posError } = await supabase
      .from('user_positions')
      .insert({
        id: positionId,
        network: payload.network,
        user_address: userAddress,
        market_id: marketId || null,
        asset_symbol: payload.assetSymbol,
        pair_address: payload.pairAddress,
        position_type: payload.positionType,
        leverage: payload.leverage,
        equity_usd: payload.equityUsd,
        exposure_usd: payload.exposureUsd,
        collateral_amount: payload.collateralAmount,
        debt_amount: payload.debtAmount,
        entry_price: entryPrice,
        mark_price: markPrice,
        liquidation_price: Number(liquidationPrice.toFixed(4)),
        health_factor: Number(healthFactor.toFixed(2)),
        status: 'ACTIVE',
      })
      .select()
      .single();

    if (posError) throw posError;

    // 3. Insert audit log into activity_logs
    try {
      await supabase.from('activity_logs').insert({
        network: payload.network,
        tx_hash: payload.txHash || null,
        user_address: userAddress,
        action_type: payload.positionType === 'SHORT' ? 'OPEN_SHORT' : 'LEVERAGE_BUY',
        asset_symbol: payload.assetSymbol,
        amount: payload.collateralAmount,
        amount_usd: payload.exposureUsd,
        details: {
          leverage: payload.leverage,
          entryPrice,
          positionType: payload.positionType,
          pairAddress: payload.pairAddress,
          positionId,
        },
      });
    } catch (logErr) {
      console.warn('Could not record activity log for position creation:', logErr);
    }

    // Invalidate liquidation and stats cache
    apiCache.invalidate('liquidations:');

    return res.status(201).json({
      success: true,
      message: 'Position created successfully',
      data: positionData,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/positions/:id/close
positionsRouter.patch('/:id/close', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = closePositionSchema.safeParse(req.body || {});
    const body = parsed.success ? parsed.data : { network: 'TESTNET' as NetworkMode };

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    const { data: updated, error } = await supabase
      .from('user_positions')
      .update({ status: 'CLOSED' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log to activity_logs if userAddress/txHash provided or from updated position
    if (updated) {
      try {
        await supabase.from('activity_logs').insert({
          network: body.network || updated.network,
          tx_hash: body.txHash || null,
          user_address: (body.userAddress || updated.user_address).toLowerCase(),
          action_type: 'CLOSE_POSITION',
          asset_symbol: updated.asset_symbol,
          amount: updated.collateral_amount,
          amount_usd: updated.exposure_usd,
          details: {
            positionId: id,
            positionType: updated.position_type,
            pairAddress: updated.pair_address,
          },
        });
      } catch (logErr) {
        console.warn('Could not record activity log for position close:', logErr);
      }
    }

    // Invalidate liquidation cache
    apiCache.invalidate('liquidations:');

    return res.json({ success: true, message: 'Position closed successfully', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

