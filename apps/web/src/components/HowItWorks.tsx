'use client';

import React from 'react';
import { ArrowRight, ShieldAlert, Layers, Cpu } from 'lucide-react';

export function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'SUPPLY TOKENIZED EQUITY',
      description: 'Deposit tokenized shares (NVDA, AAPL, TSLA, SPY) into isolated collateral markets on Robinhood Chain.',
      badge: 'ISOLATED VAULT',
      icon: Layers,
    },
    {
      number: '02',
      title: 'CHOOSE CREDIT STRATEGY',
      description: 'Borrow USDC instantly, open 1-click 2.0x leveraged long/short positions, or deposit stablecoins for yield.',
      badge: '1-CLICK MARGIN ROUTER',
      icon: Cpu,
    },
    {
      number: '03',
      title: 'AUTO-PROTECT GUARD',
      description: 'Set custom safety thresholds. Decentralized keepers automatically deleverage positions before forced liquidation.',
      badge: 'PROTECTED DELEVERAGE',
      icon: ShieldAlert,
    },
  ];

  return (
    <section className="space-y-8 font-mono">
      <div className="border-b border-white/10 pb-4 flex justify-between items-end">
        <div>
          <span className="text-xs text-[#008000] font-bold block uppercase tracking-widest">
            [PROTOCOL WORKFLOW]
          </span>
          <h2 className="text-2xl sm:text-4xl font-normal tracking-tight text-white uppercase font-mono mt-1">
            HOW LEVIER WORKS
          </h2>
        </div>
        <span className="text-xs text-[#8A8D88] uppercase hidden sm:block">
          [3-STEP MARGIN EXECUTION]
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div
              key={idx}
              className="bg-[#080908] border border-white/15 p-6 sm:p-8 rounded-sm space-y-6 flex flex-col justify-between hover:border-[#008000]/50 transition-all group"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-3xl sm:text-4xl font-bold text-[#008000] tracking-tighter">
                    {step.number}
                  </span>
                  <div className="p-2 bg-[#050505] border border-white/10 rounded-sm text-[#008000] group-hover:bg-[#008000] group-hover:text-white transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                </div>

                <span className="text-[10px] text-[#008000] bg-[#008000]/10 border border-[#008000]/30 px-2 py-0.5 rounded-sm inline-block font-bold tracking-wider">
                  {step.badge}
                </span>

                <h3 className="text-xl font-normal text-white uppercase tracking-tight font-sans">
                  {step.title}
                </h3>

                <p className="text-xs text-[#8A8D88] leading-relaxed uppercase">
                  {step.description}
                </p>
              </div>

              {idx < steps.length - 1 && (
                <div className="hidden md:flex items-center gap-2 text-[10px] text-[#008000] pt-4 border-t border-white/5">
                  <span>NEXT STEP</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
