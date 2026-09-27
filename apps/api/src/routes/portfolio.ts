import { Router, Request, Response } from 'express';
import { supabase, isLiveSupabase } from '../supabase.js';
import { PortfolioSummary, NetworkMode } from '@levier/types';

export const portfolioRouter = Router();

// GET /api/v1/portfolio/:address?network=TESTNET
portfolioRouter.get('/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address.toLowerCase();
    const network = ((req.query.network as string) || 'TESTNET').toUpperCase() as NetworkMode;

    if (!isLiveSupabase || !supabase) {
      return res.status(503).json({ success: false, error: 'Database connection is not available' });
    }

    const { data: positions, error } = await supabase
      .from('user_positions')
      .select('*')
      .eq('user_address', address)
      .eq('network', network);

    if (error) throw error;

    if (!positions || positions.length === 0) {
      const emptySummary: PortfolioSummary = {
        portfolioValueUsd: 0,
        collateralUsd: 0,
        debtUsd: 0,
        netEquityUsd: 0,
        borrowingPowerUsd: 0,
        weightedLtvPercent: 0,
        healthFactor: 999,
        pnl24hUsd: 0,
      };
      return res.json({ success: true, network, address, data: emptySummary });
    }

    let totalCollateral = 0;
    let totalDebt = 0;
    let totalPnl = 0;

    for (const pos of positions) {
      totalCollateral += Number(pos.exposure_usd || 0);
      totalDebt += Number(pos.debt_amount || 0);
      totalPnl += Number(pos.pnl_usd || 0);
    }

    const netEquity = totalCollateral - totalDebt;
    const weightedLtv = totalCollateral > 0 ? (totalDebt / totalCollateral) * 100 : 0;
    const healthFactor = totalDebt > 0 ? (totalCollateral * 0.7) / totalDebt : 999;
    const borrowingPower = Math.max(0, totalCollateral * 0.65 - totalDebt);

    const summary: PortfolioSummary = {
      portfolioValueUsd: totalCollateral,
      collateralUsd: totalCollateral,
      debtUsd: totalDebt,
      netEquityUsd: netEquity,
      borrowingPowerUsd: borrowingPower,
      weightedLtvPercent: Number(weightedLtv.toFixed(1)),
      healthFactor: Number(healthFactor.toFixed(2)),
      pnl24hUsd: Number(totalPnl.toFixed(2)),
    };

    return res.json({ success: true, network, address, data: summary });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
