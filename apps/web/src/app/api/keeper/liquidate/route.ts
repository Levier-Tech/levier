import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost } from 'viem/chains';
import LeveragePositionManagerABI from '@/lib/contracts/LeveragePositionManager.json';
import addresses from '@/lib/contracts/addresses.json';

const KEEPER_PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY as `0x${string}`;

export async function POST(req: NextRequest) {
  try {
    const { account, asset, isLong } = await req.json();

    if (!account || !asset || typeof isLong !== 'boolean') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!KEEPER_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Keeper PK not configured' }, { status: 500 });
    }

    const publicClient = createPublicClient({
      chain: localhost,
      transport: http()
    });

    const keeperAccount = privateKeyToAccount(KEEPER_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account: keeperAccount,
      chain: localhost,
      transport: http()
    });

    // @ts-ignore
    const managerAddress = addresses['LeveragePositionManager'];

    // 1. Read position to check if it exists
    const pos = await publicClient.readContract({
      address: managerAddress as `0x${string}`,
      abi: LeveragePositionManagerABI.abi,
      functionName: 'getPosition',
      args: [account, asset, isLong]
    }) as any;

    if (!pos || pos.sizeAsset === 0n) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    // 2. Simulate the liquidation tx
    // If simulation fails, it's not liquidatable.
    try {
      const { request } = await publicClient.simulateContract({
        account: keeperAccount,
        address: managerAddress as `0x${string}`,
        abi: LeveragePositionManagerABI.abi,
        functionName: 'liquidatePosition',
        args: [account, asset, isLong]
      });

      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });

      return NextResponse.json({ success: true, txHash: hash, message: 'Position liquidated successfully' });
    } catch (e: any) {
      // Simulation failed means it's likely not liquidatable (or other error)
      return NextResponse.json({ error: 'Liquidation failed. Position might be healthy.', details: e.message }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Keeper Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
