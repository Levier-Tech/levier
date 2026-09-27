'use client';

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

const COMPARISON_DATA = [
  {
    feature: 'Target assets',
    levier: 'Tokenized US equities & ETFs (NVDA, AAPL, TSLA, SPY)',
    traditional: 'Volatile native crypto tokens & altcoins',
  },
  {
    feature: 'Leverage execution',
    levier: '1-click automated margin router',
    traditional: 'Manual multi-step flash loans & swaps',
  },
  {
    feature: 'Liquidation defense',
    levier: 'Auto-Protect keeper deleverage guard',
    traditional: 'Instant harsh liquidation penalties (10-15%)',
  },
  {
    feature: 'Risk architecture',
    levier: 'Isolated collateral vaults per equity market',
    traditional: 'Shared liquidity pool risk contagion',
  },
  {
    feature: 'User interface',
    levier: 'Brokerage margin account simplicity',
    traditional: 'Complex DeFi technical jargon',
  },
  {
    feature: 'Settlement chain',
    levier: 'Robinhood Chain L2 low-fee instant finality',
    traditional: 'High network execution fees',
  },
];

export function ComparisonMatrix() {
  return (
    <section className="comparison-section section-wrap" id="comparison" aria-labelledby="comparison-title">
      <div className="section-topline">
        <span>03 / THE COMPARISON</span>
        <span>LEVIER VS TRADITIONAL DEFI</span>
      </div>
      <h2 className="section-title" id="comparison-title">
        Familiar tools.
        <br />
        <span>Fewer trade-offs.</span>
      </h2>

      <div className="comparison-card">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th className="comparison-col-levier">Levier</th>
              <th>Traditional DeFi (Aave, Compound)</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_DATA.map((row) => (
              <tr key={row.feature}>
                <td className="comparison-feature">{row.feature}</td>
                <td className="comparison-col-levier">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>{row.levier}</span>
                </td>
                <td>
                  <XCircle className="w-4 h-4" aria-hidden="true" />
                  <span>{row.traditional}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
