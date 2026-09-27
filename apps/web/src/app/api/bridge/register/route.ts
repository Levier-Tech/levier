import { NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { localhost } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import CONTRACT_ADDRESSES from '@/lib/contracts/addresses.json';

import TestnetERC20Artifact from '@/lib/contracts/TestnetERC20.json';
import PonsLeverageRegistryArtifact from '@/lib/contracts/PonsLeverageRegistry.json';
import PonsOracleRouterArtifact from '@/lib/contracts/PonsOracleRouter.json';

// In-memory cache to map coingeckoId to deployed token address
const bridgedTokens: Record<string, string> = {};

export async function POST(req: Request) {
  try {
    const { coingeckoId, symbol, name, price } = await req.json();

    if (!coingeckoId || !symbol) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Return from cache if already bridged
    if (bridgedTokens[coingeckoId]) {
      return NextResponse.json({ address: bridgedTokens[coingeckoId] });
    }

    // Purely simulated for UI
    console.log(`[Bridge Simulation] Registering mock TestnetERC20 for ${symbol}...`);

    // Generate a deterministic mock address based on the symbol
    // e.g. 0xMockTokenAddress...
    const hash = Array.from(symbol).reduce((acc: number, char: any) => acc + (char as string).charCodeAt(0), 0);
    const mockAddress = `0x${hash.toString(16).padStart(40, '0')}` as `0x${string}`;

    bridgedTokens[coingeckoId] = mockAddress;

    return NextResponse.json({ 
      success: true, 
      address: mockAddress, 
      simulated: true 
    });

  } catch (error: any) {
    console.error("[Bridge Route Error]:", error);
    return NextResponse.json({ error: error.message || "Internal Bridge Error" }, { status: 500 });
  }
}
