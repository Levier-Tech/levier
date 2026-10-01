"use client";

import React from "react";

import { X_URL } from "../lib/social";
import { useNetworkMode } from "../hooks/useNetworkMode";
const MAINNET_ANSWERS: Record<string, string> = {
  "How does borrowing work?":
    "Deposit collateral into an enabled lending market, then borrow USDG within its LTV limits. TSLA, AMZN, PLTR and AMD markets are deployed on Robinhood Chain mainnet and stay paused until each one is opened. Prices come from Chainlink.",
  "Can I trade in this preview?":
    "Not yet. The mainnet contracts are deployed and every market is paused. Lending, Long/Short, Earn and Auto-Protect open market by market after launch checks pass.",
};
const FAQ_ITEMS = [
  {
    question: "What is Levier Markets?",
    answer:
      "Levier is the credit and leverage layer for tokenized assets, designed for Robinhood Chain. Its core products include isolated collateral borrowing, ERC-4626 stablecoin yield vaults, 1-click long and short exposure, and keeper-automated position management.",
  },
  {
    question: "How does borrowing work?",
    answer:
      "Deposit collateral into an enabled lending market, then borrow USDG within its LTV limits. The current TSLA market requires fresh oracle prices and available liquidity. AMZN, PLTR, NVDA and AMD are planned faucet-token markets awaiting deployment acceptance.",
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
  const { isTestnet } = useNetworkMode();
  return (
    <section className="faq-section section-wrap" id="faq">
      <div>
        <div className="section-topline">
          <span>05 / THE DETAILS</span>
        </div>
        <h2 className="section-title">
          A little
          <br />
          <span>more clarity.</span>
        </h2>

        <p className="faq-contact">
          Still have questions?{" "}
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Reach out on X ↗
          </a>
        </p>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, idx) => (
          <details key={idx}>
            <summary>
              {item.question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{(!isTestnet && MAINNET_ANSWERS[item.question]) || item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
