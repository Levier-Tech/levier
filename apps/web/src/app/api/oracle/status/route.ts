import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { publicClient } from "@/lib/viem";
import { 
  CONTRACT_ADDRESSES, 
  PonsOracleRouterABI,
} from "@/lib/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const assetSymbol = searchParams.get("asset")?.toUpperCase();

  const oracleAddress = CONTRACT_ADDRESSES.PonsOracleRouter;

  try {
    if (assetSymbol) {
      // Find asset address from our deployment list
      const assetAddress = (CONTRACT_ADDRESSES as Record<string, string>)[assetSymbol];
      
      if (!assetAddress) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }

      const priceDiag = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: PonsOracleRouterABI,
        functionName: 'getPriceDiagnostics',
        args: [assetAddress]
      }) as any;

      const primaryPriceRaw = priceDiag ? (Array.isArray(priceDiag) ? priceDiag[0] : priceDiag.primaryPrice) : 0n;
      const twapPriceRaw = priceDiag ? (Array.isArray(priceDiag) ? priceDiag[1] : priceDiag.twapPrice) : 0n;
      const deviationBpsRaw = priceDiag ? (Array.isArray(priceDiag) ? priceDiag[2] : priceDiag.deviationBps) : 0;
      const isSafeRaw = priceDiag ? (Array.isArray(priceDiag) ? priceDiag[3] : priceDiag.isSafe) : false;

      const primaryPrice = Number(formatUnits(primaryPriceRaw, 18));
      const twapPrice = Number(formatUnits(twapPriceRaw, 18));
      const deviationBps = Number(deviationBpsRaw);
      const isSafe = Boolean(isSafeRaw);

      return NextResponse.json({
        asset: assetSymbol,
        primaryPrice,
        twapPrice,
        deviationBps,
        isSafe,
        status: isSafe ? "HEALTHY" : "CRITICAL",
      });
    }

    // Otherwise, return all specific deployed assets (PMEME, PGOV)
    const symbols = ["PMEME", "PGOV"];
    const statuses = await Promise.all(symbols.map(async (sym) => {
      const address = (CONTRACT_ADDRESSES as Record<string, string>)[sym];
      const diag = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: PonsOracleRouterABI,
        functionName: 'getPriceDiagnostics',
        args: [address]
      }).catch(() => null) as any;

      const primaryPrice = diag ? (Array.isArray(diag) ? diag[0] : diag.primaryPrice) : 0n;
      const twapPrice = diag ? (Array.isArray(diag) ? diag[1] : diag.twapPrice) : 0n;
      const deviationBps = diag ? (Array.isArray(diag) ? diag[2] : diag.deviationBps) : 0;
      const isSafe = diag ? (Array.isArray(diag) ? diag[3] : diag.isSafe) : false;

      return {
        asset: sym,
        primaryPrice: Number(formatUnits(primaryPrice, 18)),
        twapPrice: Number(formatUnits(twapPrice, 18)),
        deviationBps: Number(deviationBps),
        isSafe: Boolean(isSafe),
        status: isSafe ? "HEALTHY" : "CRITICAL",
      };
    }));

    return NextResponse.json({ statuses: statuses.filter(Boolean) });
  } catch (err) {
    console.error("Oracle fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch oracle status" }, { status: 500 });
  }
}
