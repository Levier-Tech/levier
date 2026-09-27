'use client';

import React from 'react';
import { ShieldCheck, Database, Bot, FileCode } from 'lucide-react';

export function SecurityGrid() {
  const securityPillars = [
    {
      icon: Database,
      title: 'PYTH REAL-TIME ORACLES',
      subtitle: 'SUB-SECOND SANITY FEEDS',
      description: 'High-frequency institutional oracle updates with dynamic circuit breakers prevent flash crash liquidations.',
    },
    {
      icon: ShieldCheck,
      title: 'ISOLATED RISK VAULTS',
      subtitle: 'ZERO CONTAGION RISK',
      description: 'Every tokenized equity market operates in an isolated vault. Volatility in TSLA never impacts NVDA collateral.',
    },
    {
      icon: Bot,
      title: 'DECENTRALIZED KEEPERS',
      subtitle: '24/7 AUTOMATED DEFENSE',
      description: 'Distributed keeper nodes continuously monitor position health and trigger partial deleveraging before liquidation.',
    },
    {
      icon: FileCode,
      title: 'ERC-4626 & EVM AUDITS',
      subtitle: 'STANDARD COMPOSABILITY',
      description: 'Built on standardized vault contracts, verified open-source EVM codebases, and audited risk parameters.',
    },
  ];

  return (
    <section className="space-y-8 font-mono">
      <div className="border-b border-white/10 pb-4 flex justify-between items-end">
        <div>
          <span className="text-xs text-[#008000] font-bold block uppercase tracking-widest">
            [INSTITUTIONAL GRADE]
          </span>
          <h2 className="text-2xl sm:text-4xl font-normal tracking-tight text-white uppercase font-mono mt-1">
            SECURITY & RISK ARCHITECTURE
          </h2>
        </div>
        <span className="text-xs text-[#8A8D88] uppercase hidden sm:block">
          [TRUSTED ONCHAIN INFRASTRUCTURE]
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {securityPillars.map((pillar, idx) => {
          const Icon = pillar.icon;
          return (
            <div
              key={idx}
              className="bg-[#080908] border border-white/15 p-6 rounded-sm space-y-4 hover:border-[#008000]/50 transition-all flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="p-3 bg-[#050505] border border-white/10 rounded-sm w-fit text-[#008000]">
                  <Icon className="w-6 h-6" />
                </div>

                <span className="text-[10px] text-[#008000] font-bold tracking-wider block">
                  {pillar.subtitle}
                </span>

                <h3 className="text-lg font-bold text-white uppercase tracking-tight font-sans">
                  {pillar.title}
                </h3>

                <p className="text-xs text-[#8A8D88] leading-relaxed uppercase">
                  {pillar.description}
                </p>
              </div>

              <div className="pt-3 border-t border-white/5 text-[10px] text-[#008000] font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#008000] animate-pulse" />
                <span>ACTIVE GUARD</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
