import {
  publicClient,
  walletClient,
  keeperAccount,
  supabase,
  AutoProtectABI,
  LeveraPairABI,
  ERC20ABI,
} from "../client.js";
import { config } from "../config.js";
import { BreachCandidate } from "./positionMonitor.js";
import { formatGwei, formatUnits, parseUnits, Address } from "viem";

export async function executeCandidateProtection(
  candidate: BreachCandidate,
): Promise<boolean> {
  if (!config.TRADING_ENABLED) return false;
  try {
    if ((await publicClient.getChainId()) !== config.CHAIN_ID) return false;
    // 1. Gas Ceiling Check
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceGwei = parseFloat(formatGwei(gasPrice));

    if (gasPriceGwei > config.MAX_GAS_PRICE_GWEI) {
      console.warn(
        `[KEEPER GAS CEILING] Current gas price (${gasPriceGwei.toFixed(2)} Gwei) ` +
          `exceeds ceiling limit (${config.MAX_GAS_PRICE_GWEI} Gwei). Skipping execution.`,
      );
      return false;
    }

    // 2. Check Keeper Authorization
    let isAuthorized = false;
    try {
      isAuthorized = await publicClient.readContract({
        address: config.AUTO_PROTECT_ADDRESS as Address,
        abi: AutoProtectABI,
        functionName: "isKeeper",
        args: [keeperAccount.address],
      });

      if (!isAuthorized) {
        const contractOwner = await publicClient.readContract({
          address: config.AUTO_PROTECT_ADDRESS as Address,
          abi: AutoProtectABI,
          functionName: "owner",
        });
        isAuthorized =
          contractOwner.toLowerCase() === keeperAccount.address.toLowerCase();
      }
    } catch (authErr) {
      console.warn(
        "[KEEPER AUTH CHECK] Read failed; provider details redacted.",
      );
    }

    if (!isAuthorized) {
      console.error(
        `[KEEPER AUTH ERROR] Keeper account (${keeperAccount.address}) is not authorized on AutoProtectModule!`,
      );
      return false;
    }

    // 3. Get Pair's Debt Token (USDG)
    const debtTokenAddress = await publicClient.readContract({
      address: candidate.pairAddress,
      abi: LeveraPairABI,
      functionName: "debtToken",
    });

    // 4. Calculate exact repayment amount to restore to targetLtv
    const targetLtvBps = BigInt(Math.round(candidate.targetLtvPercent * 100));
    const targetDebt = (candidate.collateralValueUsd * targetLtvBps) / 10_000n;
    let repayAmount =
      candidate.debtAmount > targetDebt
        ? candidate.debtAmount - targetDebt
        : 0n;

    if (repayAmount > candidate.maxDeleverage && candidate.maxDeleverage > 0n) {
      repayAmount = candidate.maxDeleverage;
    }

    if (repayAmount <= 0n) {
      console.log(
        `[KEEPER] No debt reduction required for ${candidate.userAddress}`,
      );
      return false;
    }

    // 5. Check Allowance and Approve USDG if needed
    const currentAllowance = await publicClient.readContract({
      address: debtTokenAddress,
      abi: ERC20ABI,
      functionName: "allowance",
      args: [keeperAccount.address, config.AUTO_PROTECT_ADDRESS as Address],
    });

    if (currentAllowance < repayAmount) {
      console.log(`[KEEPER] Approving USDG allowance for AutoProtectModule...`);
      const approveHash = await walletClient.writeContract({
        address: debtTokenAddress,
        abi: ERC20ABI,
        functionName: "approve",
        args: [config.AUTO_PROTECT_ADDRESS as Address, repayAmount * 10n],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // 6. Submit executeAutoProtect on-chain
    console.log(
      `[KEEPER EXECUTE] Deleveraging ${candidate.userAddress} on ${candidate.assetSymbol}: ` +
        `Repaying ${formatUnits(repayAmount, 18)} USDG...`,
    );

    const txHash = await walletClient.writeContract({
      address: config.AUTO_PROTECT_ADDRESS as Address,
      abi: AutoProtectABI,
      functionName: "executeAutoProtect",
      args: [candidate.pairAddress, candidate.userAddress, repayAmount],
    });

    console.log(
      `[KEEPER TX SUBMITTED] Hash: ${txHash}. Waiting for confirmation...`,
    );
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.effectiveGasPrice || gasPrice;
    const gasCostEth = parseFloat(formatUnits(gasUsed * effectiveGasPrice, 18));
    const gasCostUsd = gasCostEth * 3500; // estimated ETH price

    console.log(
      `[KEEPER SUCCESS] Tx confirmed in block ${receipt.blockNumber}! Gas used: ${gasUsed.toString()} (${gasCostEth.toFixed(6)} ETH / ~$${gasCostUsd.toFixed(2)})`,
    );

    // 7. Record Audit Log in Supabase activity_logs
    await supabase.from("activity_logs").insert({
      network: config.NETWORK_MODE,
      action_type: "AUTO_PROTECT_EXECUTION",
      user_address: candidate.userAddress,
      tx_hash: txHash,
      details: {
        pairAddress: candidate.pairAddress,
        assetSymbol: candidate.assetSymbol,
        initialLtvPercent: candidate.currentLtvPercent,
        restoredTargetLtvPercent: candidate.targetLtvPercent,
        repaidAmountUsd: parseFloat(formatUnits(repayAmount, 18)),
        gasUsed: Number(gasUsed),
        gasCostEth,
        gasCostUsd,
        blockNumber: Number(receipt.blockNumber),
        keeperAddress: keeperAccount.address,
      },
    });

    // 8. Update Position in Supabase positions table
    const remainingDebt = candidate.debtAmount - repayAmount;
    const remainingDebtUsd = parseFloat(formatUnits(remainingDebt, 18));
    const newHealthFactor =
      remainingDebtUsd > 0
        ? parseFloat(
            (
              (parseFloat(formatUnits(candidate.collateralValueUsd, 18)) *
                0.8) /
              remainingDebtUsd
            ).toFixed(2),
          )
        : 3.0;

    await supabase
      .from("user_positions")
      .update({
        exposure_usd:
          remainingDebtUsd +
          parseFloat(formatUnits(candidate.collateralValueUsd, 18)),
        health_factor: newHealthFactor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.positionId);

    return true;
  } catch (err: any) {
    console.error(
      "[KEEPER EXECUTION FAILED] Transaction could not complete; private details redacted.",
    );
    return false;
  }
}
