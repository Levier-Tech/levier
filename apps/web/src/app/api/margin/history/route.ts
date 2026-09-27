import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { z } from "zod";
import environment from "../../../../../config/environment.cjs";
import { env } from "../../../../env.mjs";
import { historyCursorSchema } from "../../../../lib/lending-history";
import { readMarginHistory } from "../../../../lib/margin-history";
import { marketDeployments } from "../../../../lib/market-deployments";
export const dynamic = "force-dynamic";
const accountSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine((x) => !/^0x0{40}$/.test(x));
export async function GET(request: NextRequest) {
  const server = environment.validate(environment.serverSchema, process.env);
  const headers = { "cache-control": "no-store" };
  let account: Address,
    cursor = null;
  try {
    if (
      [...request.nextUrl.searchParams.keys()].some(
        (k) => !["account", "cursor", "market"].includes(k),
      )
    )
      throw Error();
    account = accountSchema.parse(
      request.nextUrl.searchParams.get("account"),
    ) as Address;
    const raw = request.nextUrl.searchParams.get("cursor");
    if (raw) {
      if (raw.length > 200) throw Error();
      cursor = historyCursorSchema.parse(JSON.parse(raw));
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid history request" },
      { status: 400, headers },
    );
  }
  const market = marketDeployments.find(
    (m) => m.symbol === request.nextUrl.searchParams.get("market"),
  );
  if (!market)
    return NextResponse.json(
      { error: "Verified market unavailable" },
      { status: 503, headers },
    );
  try {
    const client = createPublicClient({
      transport: http(server.RPC_URL, {
        timeout: server.RPC_TIMEOUT_MS,
        retryCount: 0,
      }),
      cacheTime: 0,
    });
    const result = await readMarginHistory({
      client,
      market,
      account,
      explorerUrl: env.EXPLORER_URL,
      cursor,
      confirmations: env.LENDING_RECEIPT_CONFIRMATIONS,
      timeoutMs: server.RPC_TIMEOUT_MS,
      maxResponseBytes: server.RPC_MAX_RESPONSE_BYTES,
    });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      { error: "Transaction history could not be verified. Please retry." },
      { status: 503, headers },
    );
  }
}
