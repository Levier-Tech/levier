import { NextResponse } from "next/server";
import { formatUnits } from "viem";
import { publicClient } from "@/lib/viem";
import { 
  CONTRACT_ADDRESSES, 
  LeveragePositionManagerABI,
  PonsOracleRouterABI,
  PonsLeverageRegistryABI,
  ERC20ABI,
} from "@/lib/contracts";

export const dynamic = "force-dynamic";

export interface PositionData {
  id: string;
  asset: string;
  isLong: boolean;
  sizeUsd: number;
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  pnlUsd: number;
  pnlPercentage: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account");

  if (!account) {
    return NextResponse.json({ error: "Missing account parameter" }, { status: 400 });
  }

  const managerAddress = CONTRACT_ADDRESSES.LeveragePositionManager;
  const oracleAddress = CONTRACT_ADDRESSES.PonsOracleRouter;
  const registryAddress = CONTRACT_ADDRESSES.PonsLeverageRegistry;

  const activePositions: PositionData[] = [];

  try {
    // Get all registered assets dynamically from the registry
    const registeredAssets = await publicClient.readContract({
      address: registryAddress as `0x${string}`,
      abi: PonsLeverageRegistryABI,
      functionName: 'getEligibleAssets'
    }) as `0x${string}`[];

    for (const assetAddress of registeredAssets) {
      // We will check both Long and Short positions for each asset
      const [longPos, shortPos, priceDiag, symbol] = await Promise.all([
        publicClient.readContract({
          address: managerAddress as `0x${string}`,
          abi: LeveragePositionManagerABI,
          functionName: 'getPosition',
          args: [account, assetAddress, true] // Long
        }).catch(() => null) as any,
        
        publicClient.readContract({
          address: managerAddress as `0x${string}`,
          abi: LeveragePositionManagerABI,
          functionName: 'getPosition',
          args: [account, assetAddress, false] // Short
        }).catch(() => null) as any,

        publicClient.readContract({
          address: oracleAddress as `0x${string}`,
          abi: PonsOracleRouterABI,
          functionName: 'getPriceDiagnostics',
          args: [assetAddress]
        }).catch(() => null) as any,

        publicClient.readContract({
          address: assetAddress,
          abi: ERC20ABI,
          functionName: 'symbol'
        }).catch(() => 'UNKNOWN')
      ]);

      const sym = symbol as string;
      const primaryPriceRaw = priceDiag ? (Array.isArray(priceDiag) ? priceDiag[0] : priceDiag.primaryPrice) : null;
      const markPrice = primaryPriceRaw ? Number(formatUnits(primaryPriceRaw, 18)) : 0;

      // Process Long Position
      if (longPos && longPos.sizeAsset > 0n) {
        const entryPrice = Number(formatUnits(longPos.entryPrice, 18));
        const sizeAsset = Number(formatUnits(longPos.sizeAsset, 18));
        const sizeUsd = sizeAsset * markPrice;
        const collateralUsd = Number(formatUnits(longPos.collateralAmount, 18));
        
        const entrySizeUsd = sizeAsset * entryPrice;
        const leverage = entrySizeUsd / collateralUsd;
        
        const pnlUsd = ((markPrice - entryPrice) / entryPrice) * entrySizeUsd;
        const pnlPercentage = (pnlUsd / collateralUsd) * 100;
        
        // Simplified liquidation price for frontend
        const liquidationPrice = entryPrice * (1 - (1 / leverage) * 0.95); 

        activePositions.push({
          id: `pos-long-${sym}-${Date.now()}`,
          asset: sym,
          isLong: true,
          sizeUsd,
          collateralUsd,
          leverage,
          entryPrice,
          markPrice,
          liquidationPrice,
          pnlUsd,
          pnlPercentage
        });
      }

      // Process Short Position
      if (shortPos && shortPos.sizeAsset > 0n) {
        const entryPrice = Number(formatUnits(shortPos.entryPrice, 18));
        const sizeAsset = Number(formatUnits(shortPos.sizeAsset, 18));
        const sizeUsd = sizeAsset * markPrice;
        const collateralUsd = Number(formatUnits(shortPos.collateralAmount, 18));
        
        const entrySizeUsd = sizeAsset * entryPrice;
        const leverage = entrySizeUsd / collateralUsd;
        
        // Short PnL = (Entry - Mark)
        const pnlUsd = ((entryPrice - markPrice) / entryPrice) * entrySizeUsd;
        const pnlPercentage = (pnlUsd / collateralUsd) * 100;
        
        // Simplified liquidation price for short
        const liquidationPrice = entryPrice * (1 + (1 / leverage) * 0.95); 

        activePositions.push({
          id: `pos-short-${sym}-${Date.now()}`,
          asset: sym,
          isLong: false,
          sizeUsd,
          collateralUsd,
          leverage,
          entryPrice,
          markPrice,
          liquidationPrice,
          pnlUsd,
          pnlPercentage
        });
      }
    }

    return NextResponse.json({ positions: activePositions });
  } catch (err) {
    console.error("Positions fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch positions" }, { status: 500 });
  }
}
