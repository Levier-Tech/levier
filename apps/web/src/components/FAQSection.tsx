"use client";

import React from "react";

const FAQ_ITEMS = [
  {
    question: "What is Levier Markets?",
    answer:
      "Levier is the credit and leverage layer for tokenized assets, designed for Robinhood Chain. Its core products include isolated collateral borrowing, ERC-4626 stablecoin yield vaults, 1-click long and short exposure, and keeper-automated position management.",
  },
  {
    question: "How does borrowing work?",
    answer:
      "Deposit collateral into an enabled lending market, then borrow USDG within its LTV limits. The current TSLA market requires fresh oracle prices and available liquidity. AMZN, PLTR, NFLX and AMD are planned faucet-token markets awaiting deployment acceptance.",
  },
  {
    question: "What is Auto-Protect?",
    answer:
      "Auto-Protect is an automated keeper defense system that partially deleverages your position when it approaches a user-defined risk threshold. Automated keeper nodes repay debt before third-party liquidation occurs, protecting equity capital.",
  },
  {
    question: "Can I trade in this preview?",
    answer:
      "Supervised TSLA lending and Long/Short testing is available when its publisher, prices and liquidity checks pass. Other faucet-token markets are being prepared. Earn and Auto-Protect are not enabled for this release.",
  },
];

export function FAQSection() {
  return (
    <section className="faq-section section-wrap" id="faq">
      <div>
        <div className="section-topline">
          <span>03 / THE DETAILS</span>
        </div>
        <h2 className="section-title">
          A little
          <br />
          <span>more clarity.</span>
        </h2>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, idx) => (
          <details key={idx}>
            <summary>
              {item.question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
