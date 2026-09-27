import { Router, Request, Response } from "express";
import { supabase, isLiveSupabase } from "../supabase.js";
import { MarketConfig, NetworkMode } from "@levera/types";
import { apiCache } from "../utils/cache.js";

export const marketsRouter = Router();

// GET /api/v1/markets?network=TESTNET&category=Equities
marketsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const network = (
      (req.query.network as string) || "TESTNET"
    ).toUpperCase() as NetworkMode;
    const category = req.query.category as string | undefined;
    const cacheKey = `markets:${network}:${category || "ALL"}`;

    const cached = apiCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!isLiveSupabase || !supabase) {
      return res
        .status(503)
        .json({
          success: false,
          error: "Database connection is not available",
        });
    }

    let query = supabase.from("markets").select("*").eq("network", network);
    if (category && category !== "All") {
      query = query.eq("category", category);
    }
    const { data, error } = await query;
    if (error) throw error;

    const responsePayload = {
      success: true,
      network,
      count: data?.length || 0,
      data,
    };
    apiCache.set(cacheKey, responsePayload, 10);
    return res.json(responsePayload);
  } catch (err: any) {
    return res
      .status(500)
      .json({ success: false, error: "Market service unavailable" });
  }
});

// GET /api/v1/markets/:slug
marketsRouter.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const network = req.query.network as NetworkMode;
    const cacheKey = `markets:${network}:slug:${slug}`;

    const cached = apiCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    if (!isLiveSupabase || !supabase) {
      return res
        .status(503)
        .json({
          success: false,
          error: "Database connection is not available",
        });
    }

    const { data, error } = await supabase
      .from("markets")
      .select("*")
      .eq("slug", slug)
      .eq("network", network)
      .single();
    if (error)
      return res
        .status(404)
        .json({ success: false, error: "Market not found" });

    const responsePayload = { success: true, data };
    apiCache.set(cacheKey, responsePayload, 10);
    return res.json(responsePayload);
  } catch (err: any) {
    return res
      .status(500)
      .json({ success: false, error: "Market service unavailable" });
  }
});
