'use client';

import React from 'react';
import { Cpu, Database, ShieldCheck, Zap } from 'lucide-react';

export function EcosystemBar() {
  const partners = [
    {
      name: 'ROBINHOOD CHAIN',
      role: 'PRIMARY L2 SETTLEMENT',
      icon: Zap,
    },
    {
      name: 'PYTH NETWORK',
      role: 'REAL-TIME PRICE ORACLES',
      icon: Database,
    },
    {
      name: 'ERC-4626 STANDARD',
      role: 'YIELD VAULT COMPOSABILITY',
      icon: ShieldCheck,
    },
    {
      name: 'SUPABASE & EVM INDEXER',
      role: 'HIGH-SPEED STATE SYNC',
      icon: Cpu,
    },
  ];

  return (
    <section className="bg-[#080908] border border-white/10 p-6 sm:p-8 rounded-sm space-y-6 font-mono">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/10 pb-4 gap-2">
        <span className="text-xs text-[#008000] font-bold uppercase tracking-widest">
          [ECOSYSTEM & INTEGRATIONS]
        </span>
        <span className="text-[10px] text-[#8A8D88] uppercase">
          POWERING ROBINHOOD CHAIN CREDIT MARKETS
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {partners.map((partner, idx) => {
          const Icon = partner.icon;
          return (
            <div
              key={idx}
              className="bg-[#050505] border border-white/5 p-4 rounded-sm hover:border-[#008000]/40 transition-colors flex items-center gap-3"
            >
              <div className="p-2 bg-[#080908] border border-white/10 text-[#008000] rounded-sm shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="space-y-0.5 overflow-hidden">
                <div className="text-xs font-bold text-white uppercase tracking-wider truncate">
                  {partner.name}
                </div>
                <div className="text-[9px] text-[#8A8D88] uppercase truncate">
                  {partner.role}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
