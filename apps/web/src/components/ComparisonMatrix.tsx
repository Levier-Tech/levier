'use client';

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

export function ComparisonMatrix() {
  const comparisonData = [
    {
      feature: 'TARGET ASSETS',
      levier: 'Tokenized US Equities & ETFs (NVDA, AAPL, TSLA, SPY)',
      levierPass: true,
      traditional: 'Volatile Native Crypto Tokens & Altcoins',
      traditionalPass: false,
    },
    {
      feature: 'LEVERAGE EXECUTION',
      levier: '1-Click Automated Margin Router',
      levierPass: true,
      traditional: 'Manual Multi-Step Flash Loans & Swaps',
      traditionalPass: false,
    },
    {
      feature: 'LIQUIDATION DEFENSE',
      levier: 'Auto-Protect Keeper Deleverage Guard',
      levierPass: true,
      traditional: 'Instant Harsh Liquidation Penalties (10-15%)',
      traditionalPass: false,
    },
    {
      feature: 'RISK ARCHITECTURE',
      levier: 'Isolated Collateral Vaults per Equity Market',
      levierPass: true,
      traditional: 'Shared Liquidity Pool Risk Contagion',
      traditionalPass: false,
    },
    {
      feature: 'USER INTERFACE UX',
      levier: 'Brokerage Margin Account Simplicity',
      levierPass: true,
      traditional: 'Complex DeFi Technical Jargon',
      traditionalPass: false,
    },
    {
      feature: 'SETTLEMENT CHAIN',
      levier: 'Robinhood Chain L2 Low-Fee Instant Finality',
      levierPass: true,
      traditional: 'High Network Execution Fees',
      traditionalPass: false,
    },
  ];

  return (
    <section className="space-y-8 font-mono">
      <div className="border-b border-white/10 pb-4 flex justify-between items-end">
        <div>
          <span className="text-xs text-[#008000] font-bold block uppercase tracking-widest">
            [PRODUCT ADVANTAGE]
          </span>
          <h2 className="text-2xl sm:text-4xl font-normal tracking-tight text-white uppercase font-mono mt-1">
            LEVIER VS TRADITIONAL DEFI
          </h2>
        </div>
        <span className="text-xs text-[#8A8D88] uppercase hidden sm:block">
          [WHY CHOOSE LEVIER]
        </span>
      </div>

      <div className="bg-[#080908] border border-white/15 rounded-sm overflow-hidden">
        <div className="overflow-x-auto touch-scroll">
          <table className="w-full text-left border-collapse font-mono text-xs uppercase min-w-[600px] sm:min-w-[700px]">
            <thead>
              <tr className="border-b border-white/15 bg-[#050505] text-[#8A8D88]">
                <th className="p-3 sm:p-5 md:p-6 w-1/3">FEATURE / CAPABILITY</th>
                <th className="p-3 sm:p-5 md:p-6 w-1/3 text-[#008000] font-bold bg-[#008000]/10 border-x border-[#008000]/20">
                  LEVIER MARKETS
                </th>
                <th className="p-3 sm:p-5 md:p-6 w-1/3 text-[#8A8D88]">
                  TRADITIONAL DEFI (AAVE/COMPOUND)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-white">
              {comparisonData.map((row, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-white/[0.02] transition-colors"
                >
                  <td className="p-3 sm:p-5 md:p-6 font-bold text-white tracking-wider">
                    {row.feature}
                  </td>
                  <td className="p-3 sm:p-5 md:p-6 bg-[#008000]/5 border-x border-[#008000]/20 text-[#008000] font-semibold">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#008000] shrink-0 mt-0.5" />
                      <span>{row.levier}</span>
                    </div>
                  </td>
                  <td className="p-3 sm:p-5 md:p-6 text-[#8A8D88]">
                    <div className="flex items-start gap-2.5">
                      <XCircle className="w-4 h-4 text-[#FF4D4D]/70 shrink-0 mt-0.5" />
                      <span>{row.traditional}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
