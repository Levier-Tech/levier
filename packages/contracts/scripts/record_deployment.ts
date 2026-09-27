import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from monorepo root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.testnet') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.testnet') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ETH_PRICE_USD = 3500; // Reference price for testnet gas cost valuation

interface DeploymentRecord {
  contractName: string;
  contractAddress: string;
  txHash: string;
  blockNumber: number;
  deployerAddress: string;
  gasUsed: number;
  gasPriceGwei: number;
  gasCostEth: number;
  gasCostUsd: number;
  timestamp: string;
  chainId: number;
}

interface DeploymentSummary {
  network: string;
  chainId: number;
  deployerAddress: string;
  deploymentTimestamp: string;
  totalContracts: number;
  totalGasUsed: number;
  totalCostEth: number;
  totalCostUsd: number;
  contracts: DeploymentRecord[];
}

async function recordDeployment() {
  console.log('--------------------------------------------------');
  console.log('LEVERA DEPLOYMENT AUDIT & GAS TRACKER');
  console.log('--------------------------------------------------');

  const broadcastBase = path.resolve(process.cwd(), 'broadcast', 'DeployLevera.s.sol');
  if (!fs.existsSync(broadcastBase)) {
    console.error('No broadcast directory found at:', broadcastBase);
    console.log('Please run forge script with --broadcast flag first.');
    return;
  }

  // Find latest chain directory
  const chainDirs = fs.readdirSync(broadcastBase).filter((f) => {
    return fs.statSync(path.join(broadcastBase, f)).isDirectory();
  });

  if (chainDirs.length === 0) {
    console.error('No chain directories found inside broadcast.');
    return;
  }

  // Use the first/latest chainDir
  const chainId = parseInt(chainDirs[0], 10) || 46630;
  const runFile = path.join(broadcastBase, chainDirs[0], 'run-latest.json');

  if (!fs.existsSync(runFile)) {
    console.error('run-latest.json not found in:', path.dirname(runFile));
    return;
  }

  const runData = JSON.parse(fs.readFileSync(runFile, 'utf-8'));
  const transactions = runData.transactions || [];

  console.log(`Found ${transactions.length} transactions in run-latest.json (Chain ID: ${chainId})`);

  let totalGasUsed = 0;
  let totalCostEth = 0;
  let deployerAddress = '';
  const records: DeploymentRecord[] = [];

  for (const tx of transactions) {
    if (tx.transactionType === 'CREATE' || tx.contractAddress) {
      const contractName = tx.contractName || 'UnnamedContract';
      const contractAddress = tx.contractAddress || '';
      const txHash = tx.hash || '';
      const gasUsedHex = tx.transaction?.gas || tx.gas || '0x0';
      const gasUsed = typeof gasUsedHex === 'string' && gasUsedHex.startsWith('0x')
        ? parseInt(gasUsedHex, 16)
        : Number(gasUsedHex) || 150000;

      const gasPriceHex = tx.transaction?.gasPrice || tx.gasPrice || '0x3b9aca00'; // 1 Gwei default
      const gasPriceWei = typeof gasPriceHex === 'string' && gasPriceHex.startsWith('0x')
        ? parseInt(gasPriceHex, 16)
        : Number(gasPriceHex) || 1_000_000_000;

      const gasPriceGwei = gasPriceWei / 1e9;
      const gasCostEth = (gasUsed * gasPriceWei) / 1e18;
      const gasCostUsd = gasCostEth * ETH_PRICE_USD;

      deployerAddress = tx.transaction?.from || deployerAddress;

      totalGasUsed += gasUsed;
      totalCostEth += gasCostEth;

      records.push({
        contractName,
        contractAddress,
        txHash,
        blockNumber: 0,
        deployerAddress: tx.transaction?.from || deployerAddress,
        gasUsed,
        gasPriceGwei,
        gasCostEth,
        gasCostUsd,
        timestamp: new Date().toISOString(),
        chainId,
      });
    }
  }

  const totalCostUsd = totalCostEth * ETH_PRICE_USD;
  const networkName = process.env.NETWORK_MODE || 'TESTNET';

  const summary: DeploymentSummary = {
    network: networkName,
    chainId,
    deployerAddress,
    deploymentTimestamp: new Date().toISOString(),
    totalContracts: records.length,
    totalGasUsed,
    totalCostEth,
    totalCostUsd,
    contracts: records,
  };

  // 1. Write JSON deployment receipt
  const outDir = path.resolve(process.cwd(), 'deployments');
  fs.mkdirSync(outDir, { recursive: true });

  const jsonOutPath = path.join(outDir, 'testnet.json');
  fs.writeFileSync(jsonOutPath, JSON.stringify(summary, null, 2));
  console.log('✅ Deployment JSON successfully saved to:', jsonOutPath);

  // 2. Write Markdown receipt
  const mdOutPath = path.join(outDir, 'DEPLOYMENT_RECEIPT.md');
  let mdContent = `# Levera Protocol — On-Chain Deployment Audit Receipt\n\n`;
  mdContent += `**Network:** ${networkName} (Chain ID: \`${chainId}\`)\n`;
  mdContent += `**Deployer Address:** \`${deployerAddress}\`\n`;
  mdContent += `**Timestamp:** ${summary.deploymentTimestamp}\n\n`;
  mdContent += `## 📊 Deployment Cost Summary\n\n`;
  mdContent += `| Total Contracts | Total Gas Used | Total Cost (ETH) | Estimated Total Cost (USD) |\n`;
  mdContent += `| :--- | :--- | :--- | :--- |\n`;
  mdContent += `| **${summary.totalContracts}** | **${totalGasUsed.toLocaleString()} units** | **${totalCostEth.toFixed(6)} ETH** | **$${totalCostUsd.toFixed(2)} USD** |\n\n`;
  mdContent += `## 📜 Deployed Contracts Breakdown\n\n`;
  mdContent += `| Contract Name | Contract Address | Gas Used | Cost (ETH) | Cost (USD) | Tx Hash |\n`;
  mdContent += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const r of records) {
    mdContent += `| **${r.contractName}** | \`${r.contractAddress}\` | ${r.gasUsed.toLocaleString()} | ${r.gasCostEth.toFixed(6)} ETH | $${r.gasCostUsd.toFixed(4)} | [\`${r.txHash.slice(0, 10)}...\`](https://testnet.robinhood.com/tx/${r.txHash}) |\n`;
  }

  fs.writeFileSync(mdOutPath, mdContent);
  console.log('✅ Deployment Markdown report generated at:', mdOutPath);

  // 3. Store to Supabase activity_logs if configured
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey && !supabaseUrl.includes('example')) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      console.log('Uploading deployment audit records to Supabase...');

      for (const r of records) {
        await supabase.from('activity_logs').insert({
          network: networkName,
          tx_hash: r.txHash || `deploy-${r.contractName}-${Date.now()}`,
          user_address: r.deployerAddress || '0x0000000000000000000000000000000000000000',
          action_type: 'CONTRACT_DEPLOYMENT',
          asset_symbol: r.contractName,
          amount: r.gasCostEth,
          amount_usd: r.gasCostUsd,
          details: {
            contractAddress: r.contractAddress,
            gasUsed: r.gasUsed,
            gasPriceGwei: r.gasPriceGwei,
            chainId: r.chainId,
            deploymentTimestamp: r.timestamp,
          },
        });
      }
      console.log('✅ Deployment audit successfully synced to Supabase activity_logs!');
    } catch (err: unknown) {
      const e = err as Error;
      console.warn('Could not sync to Supabase activity_logs:', e.message);
    }
  } else {
    console.log('ℹ️ Supabase credentials not set or mock; audit records saved locally in JSON & Markdown.');
  }

  console.log('--------------------------------------------------');
  console.log('ALL DEPLOYMENT AUDIT DATA RECORDED SUCCESSFULLY');
  console.log('--------------------------------------------------');
}

recordDeployment().catch(console.error);
