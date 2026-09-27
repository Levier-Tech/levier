'use client';

import React from 'react';
import { ArrowRight, ShieldAlert, Layers, Cpu } from 'lucide-react';

export function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Supply tokenized equity',
      description: 'Deposit tokenized shares (NVDA, AAPL, TSLA, SPY) into isolated collateral markets on Robinhood Chain.',
      badge: 'Isolated vault',
      icon: Layers,
      tilt: 'tilt-a',
    },
    {
      number: '02',
      title: 'Choose credit strategy',
      description: 'Borrow USDC instantly, open 1-click 2.5x leveraged long/short positions, or deposit stablecoins for yield.',
      badge: '1-click margin router',
      icon: Cpu,
      tilt: 'tilt-b',
    },
    {
      number: '03',
      title: 'Auto-Protect guard',
      description: 'Set custom safety thresholds. Decentralized keepers automatically deleverage positions before forced liquidation.',
      badge: 'Protected deleverage',
      icon: ShieldAlert,
      tilt: 'tilt-c',
    },
  ];

  return (
    <section className="how-it-works section-wrap" id="how-it-works" aria-labelledby="how-it-works-title">
      <div className="section-topline">
        <span>02 / THE MECHANICS</span>
        <span>THREE STEPS TO EXPOSURE</span>
      </div>
      <h2 className="section-title" id="how-it-works-title">
        Built for a
        <br />
        <span>simple workflow.</span>
      </h2>

      <div className="how-it-works-grid">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div className="how-it-works-card" key={step.number}>
              <div className="how-it-works-card-top">
                <span className="how-it-works-number">{step.number}</span>
                <span className={`mini-stock-card ${step.tilt}`}>
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </span>
              </div>

              <span className="app-badge">{step.badge}</span>

              <h3>{step.title}</h3>
              <p>{step.description}</p>

              {idx < steps.length - 1 && (
                <div className="how-it-works-next">
                  <span>Next step</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
