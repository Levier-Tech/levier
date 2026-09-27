import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { marketsRouter } from "./routes/markets.js";
import { vaultsRouter } from "./routes/vaults.js";
import { positionsRouter } from "./routes/positions.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { activityRouter } from "./routes/activity.js";
import { autoProtectRouter } from "./routes/autoProtect.js";
import { liquidationsRouter } from "./routes/liquidations.js";
import { isLiveSupabase } from "./supabase.js";

const app = express();

app.use(cors({ origin: config.WEB_ORIGIN }));
app.use(express.json());
app.use("/api/v1", (req, res, next) => {
  if (
    req.query.network !== undefined &&
    req.query.network !== config.NETWORK_MODE
  )
    return res.status(400).json({
      success: false,
      error: "Network does not match active deployment",
    });
  req.query.network = config.NETWORK_MODE;
  if (
    !config.TRADING_ENABLED &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  )
    return res.status(503).json({
      success: false,
      error: "Writes await receipt reconciliation and testnet validation",
    });
  next();
});

// Request logger middleware
app.use((req, _res, next) => {
  const start = Date.now();
  next();
  const duration = Date.now() - start;
  console.log(`[API] ${req.method} ${req.path} - ${duration}ms`);
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "degraded",
    testnetReady: false,
    writesEnabled: config.TRADING_ENABLED,
    databaseVerified: false,
    reason: "Deployment and canonical indexing require verification",
    service: "Levera Markets REST API",
    version: "1.0.0",
    mode: config.NODE_ENV,
    defaultNetwork: config.NETWORK_MODE,
    supabaseConfigured: isLiveSupabase,
    timestamp: new Date().toISOString(),
  });
});

// Mount V1 API Routes
app.use("/api/v1/markets", marketsRouter);
app.use("/api/v1/vaults", vaultsRouter);
app.use("/api/v1/positions", positionsRouter);
app.use("/api/v1/portfolio", portfolioRouter);
app.use("/api/v1/activity", activityRouter);
app.use("/api/v1/auto-protect", autoProtectRouter);
app.use("/api/v1/liquidations", liquidationsRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found" });
});

// Error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[API Error] Request failed; provider details redacted.");
    res.status(500).json({ success: false, error: "Internal Server Error" });
  },
);

const PORT = parseInt(config.PORT, 10);
app.listen(PORT, config.API_BIND_HOST, () => {
  console.log(
    `[Levera API] Microservice listening on http://${config.API_BIND_HOST}:${PORT}`,
  );
  console.log(`[Levera API] Default Network: ${config.NETWORK_MODE}`);
  console.log(`[Levera API] Supabase Live Mode: ${isLiveSupabase}`);
});

export default app;
