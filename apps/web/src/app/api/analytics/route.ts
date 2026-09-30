import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { retryingHttp } from "../../../lib/lagging-node-retry";
import environment from "../../../../config/environment.cjs";
import { env } from "../../../env.mjs";
import {
  readAnalyticsSnapshot,
  type AnalyticsSnapshot,
  type AnalyticsMarket,
} from "../../../lib/analytics";
import { marketDeployments } from "../../../lib/market-deployments";
export const dynamic = "force-dynamic";
let cached: { at: number; value: AnalyticsSnapshot } | null = null;
let inFlight: Promise<AnalyticsSnapshot> | null = null;
export async function GET(request: NextRequest) {
  const server = environment.validate(environment.serverSchema, process.env);
  const headers = { "cache-control": "no-store" };
  if (request.nextUrl.searchParams.size)
    return NextResponse.json(
      { error: "This endpoint accepts only the configured market scope." },
      { status: 400, headers },
    );
  if (!marketDeployments.length)
    return NextResponse.json(
      { error: "Verified market configuration unavailable." },
      { status: 503, headers },
    );
  try {
    if (
      cached &&
      Date.now() - cached.at < env.UI_POLL_INTERVAL_MS &&
      Date.now() / 1000 - Number(cached.value.blockTimestamp) <=
        server.ANALYTICS_MAX_BLOCK_AGE_SECONDS
    )
      return NextResponse.json(cached.value, { headers });
    if (!inFlight) {
      const configured: AnalyticsMarket[] = marketDeployments.flatMap(
        ({ symbol, long, margin }) => [
          { label: `${symbol} Long / lending`, deployment: long },
          { label: `${symbol} Short`, deployment: margin.short },
        ],
      );
      const client = createPublicClient({
        transport: retryingHttp(server.RPC_URL, {
          timeout: server.RPC_TIMEOUT_MS,
          retryCount: 0,
        }),
        cacheTime: 0,
      });
      inFlight = readAnalyticsSnapshot(
        client,
        configured,
        env.LENDING_RECEIPT_CONFIRMATIONS,
        marketDeployments.map(({ margin, long }) => ({
          deployment: margin,
          long,
        })),
        server.ANALYTICS_MAX_BLOCK_AGE_SECONDS,
      )
        .then((value) => {
          cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return NextResponse.json(await inFlight, { headers });
  } catch {
    return NextResponse.json(
      { error: "Onchain analytics could not be verified. Please retry." },
      { status: 503, headers },
    );
  }
}
