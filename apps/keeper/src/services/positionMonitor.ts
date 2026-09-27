import { publicClient, supabase, LeveraPairABI, AutoProtectABI } from '../client.js';
import { config } from '../config.js';
import { Address } from 'viem';

export interface BreachCandidate {
  positionId: string;
  userAddress: Address;
  pairAddress: Address;
  assetSymbol: string;
  debtAmount: bigint;
  collateralValueUsd: bigint;
  currentLtvPercent: number;
  triggerLtvPercent: number;
  targetLtvPercent: number;
  maxDeleverage: bigint;
}

export async function scanPositions(): Promise<BreachCandidate[]> {
  const candidates: BreachCandidate[] = [];

  try {
    // 1. Fetch active leveraged positions joined with market configuration
    let { data: positions, error: posError } = await supabase
      .from('user_positions')
      .select('*, markets(id, slug, asset_symbol, pair_address)')
      .eq('network', config.NETWORK_MODE)
      .in('status', ['ACTIVE', 'OPEN']);

    // Fallback if pair_address column is pending database migration in Supabase
    if (posError && posError.message && posError.message.includes('pair_address')) {
      const fallbackResult = await supabase
        .from('user_positions')
        .select('*, markets(id, slug, asset_symbol)')
        .eq('network', config.NETWORK_MODE)
        .in('status', ['ACTIVE', 'OPEN']);
      positions = fallbackResult.data;
      posError = fallbackResult.error;
    }

    if (posError) {
      console.error('[KEEPER MONITOR] Error fetching positions:', posError);
      return candidates;
    }

    if (!positions || positions.length === 0) {
      return candidates;
    }

    // 2. Fetch all user auto-protect configurations
    const { data: configs, error: cfgError } = await supabase
      .from('auto_protect_configs')
      .select('*')
      .eq('network', config.NETWORK_MODE)
      .eq('is_enabled', true);

    if (cfgError) {
      console.error('[KEEPER MONITOR] Error fetching configs:', cfgError);
      return candidates;
    }

    const configMap = new Map<string, any>();
    if (configs) {
      for (const c of configs) {
        configMap.set(c.user_address.toLowerCase(), c);
      }
    }

    // 3. Evaluate each position
    for (const pos of positions) {
      const userAddr = pos.user_address.toLowerCase() as Address;
      const userCfg = configMap.get(userAddr);

      // Skip if user has not enabled auto-protect
      if (!userCfg || !userCfg.is_enabled) {
        continue;
      }

      // Dynamically resolve pair address from relational markets table or position record
      const pairAddress = (pos.markets?.pair_address || pos.pair_address) as Address;

      if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
        // Skip position if pair address is not yet configured for this market
        continue;
      }

      try {
        // Read on-chain rule configuration from AutoProtectModule
        const onchainCfg = await publicClient.readContract({
          address: config.AUTO_PROTECT_ADDRESS as Address,
          abi: AutoProtectABI,
          functionName: 'userConfigs',
          args: [userAddr, pairAddress],
        });

        const [isEnabled, triggerLtvBps, targetLtvBps, maxDeleverage] = onchainCfg;

        if (!isEnabled || triggerLtvBps === 0n) {
          continue;
        }

        // Read on-chain position from LeveraPair
        const positionData = await publicClient.readContract({
          address: pairAddress,
          abi: LeveraPairABI,
          functionName: 'getPosition',
          args: [userAddr],
        });

        const [, debtAmount, collateralValueUsd] = positionData;

        if (collateralValueUsd === 0n || debtAmount === 0n) {
          continue;
        }

        const currentLtvBps = (debtAmount * 10_000n) / collateralValueUsd;
        const currentLtvPercent = Number(currentLtvBps) / 100;
        const triggerLtvPercent = Number(triggerLtvBps) / 100;
        const targetLtvPercent = Number(targetLtvBps) / 100;

        // Check if LTV threshold breached
        if (currentLtvBps >= triggerLtvBps) {
          console.warn(
            `[KEEPER ALERT] Breach detected for ${userAddr} on ${pos.asset_symbol}: ` +
              `Current LTV: ${currentLtvPercent.toFixed(2)}% >= Trigger: ${triggerLtvPercent.toFixed(2)}%`
          );

          candidates.push({
            positionId: pos.id,
            userAddress: userAddr,
            pairAddress,
            assetSymbol: pos.asset_symbol,
            debtAmount,
            collateralValueUsd,
            currentLtvPercent,
            triggerLtvPercent,
            targetLtvPercent,
            maxDeleverage,
          });
        }
      } catch (checkErr) {
        // Skip positions where pair contract call reverts or address not yet deployed on-chain
        continue;
      }
    }
  } catch (err) {
    console.error('[KEEPER MONITOR] Unexpected error in scanPositions:', err);
  }

  return candidates;
}
