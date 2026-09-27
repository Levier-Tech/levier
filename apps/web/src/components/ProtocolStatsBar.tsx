'use client';

import React from 'react';
import { ShieldCheck, TrendingUp, DollarSign, Lock } from 'lucide-react';

export function ProtocolStatsBar() {
  const stats = [
    {
      label: 'TOTAL COLLATERAL SUPPLIED',
      value: '$42,850,200',
      change: '+14.2% 7D',
      icon: Lock,
    },
    {
      label: 'TOTAL BORROWED DEBT',
      value: '$18,400,850',
      change: '+9.8% 7D',
      icon: DollarSign,
    },
    {
      label: 'STABLECOIN SUPPLY APY',
      value: '8.45%',
      change: 'NET YIELD',
      icon: TrendingUp,
      highlight: true,
    },
    {
      label: 'AUTO-PROTECTED VALUE',
      value: '$1,240,000+',
      change: '100% PREVENTED',
      icon: ShieldCheck,
      highlight: true,
    },
  ];

  return (
    <div className="w-full bg-[#080908] border border-white/10 rounded-sm p-4 sm:p-6 font-mono uppercase">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 divider-x">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className="space-y-1.5 p-2 sm:p-3 bg-[#050505]/60 border border-white/5 rounded-sm hover:border-[#008000]/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] sm:text-xs text-[#8A8D88] tracking-wider block">
                  {stat.label}
                </span>
                <Icon className={`w-3.5 h-3.5 ${stat.highlight ? 'text-[#008000]' : 'text-[#8A8D88]'}`} />
              </div>

              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums">
                {stat.value}
              </div>

              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#008000] animate-pulse" />
                <span className={stat.highlight ? 'text-[#008000] font-bold' : 'text-[#8A8D88]'}>
                  {stat.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
