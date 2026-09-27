import { NextRequest, NextResponse } from "next/server";
import environment from "../../../../config/environment.cjs";
import {
  boundedText,
  validateRpc,
  sanitizedRpcResponse,
} from "../../../lib/rpc-proxy.mjs";
import { env } from "../../../env.mjs";
export const dynamic = "force-dynamic";
function failure(status: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32603, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}
export async function POST(request: NextRequest) {
  const server = environment.validate(environment.serverSchema, process.env);
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const forwardedHost = request.headers.get("x-forwarded-host");
      const host =
        forwardedHost || request.headers.get("host") || request.nextUrl.host;
      if (originHost !== host && origin !== request.nextUrl.origin) {
        return failure(403, "Origin not allowed");
      }
    } catch {
      return failure(403, "Origin not allowed");
    }
  }
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return failure(415, "JSON required");
  let input;
  try {
    input = validateRpc(
      JSON.parse(await boundedText(request.body, server.RPC_MAX_BODY_BYTES)),
      server.RPC_MAX_BATCH_SIZE,
    );
  } catch {
    return failure(400, "Invalid RPC request");
  }
  try {
    const chain = await fetch(server.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "chain-check",
        method: "eth_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(server.RPC_TIMEOUT_MS),
      cache: "no-store",
    });
    const chainData = JSON.parse(
      await boundedText(chain.body, server.RPC_MAX_RESPONSE_BYTES),
    );
    if (!chain.ok || chainData.result !== `0x${env.CHAIN_ID.toString(16)}`)
      throw new Error("Wrong RPC chain");
    const response = await fetch(server.RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(server.RPC_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("RPC unavailable");
    return NextResponse.json(
      sanitizedRpcResponse(
        input,
        JSON.parse(
          await boundedText(response.body, server.RPC_MAX_RESPONSE_BYTES),
        ),
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return failure(502, "RPC temporarily unavailable");
  }
}
export async function GET() {
  return NextResponse.json({ status: "configured", network: env.NETWORK_MODE });
}
