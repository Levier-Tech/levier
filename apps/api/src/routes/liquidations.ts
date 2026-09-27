import { Router } from 'express';

export const liquidationsRouter = Router();

// Legacy tables do not cover the deployed Long/Short markets. Restore these
// endpoints only after canonical multi-market indexing and USD valuation exist.
liquidationsRouter.get(['/heatmap', '/stats'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({
    success: false,
    error: 'Canonical multi-market risk analytics are not available yet.',
    code: 'RISK_ANALYTICS_UNAVAILABLE',
  });
});
