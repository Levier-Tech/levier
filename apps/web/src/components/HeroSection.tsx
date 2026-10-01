'use client';

import React from 'react';
import { StockCardScene } from './StockCardScene';
import { MarketConfig } from '@levier/types';
import { CABadge } from './CABadge';
import { env } from '../env.mjs';

interface HeroSectionProps {
  markets?: MarketConfig[];
  onSelectProductTab?: (tab: 'borrow' | 'earn' | 'leverage') => void;
  onSelectMarketAsset?: (ticker: string) => void;
}

export function HeroSection({
  markets,
  onSelectProductTab,
  onSelectMarketAsset,
}: HeroSectionProps) {
  const tokenCA = env.TOKEN_CA ?? '';

  const handleSelectTab = (tab: 'borrow' | 'earn' | 'leverage') => {
    if (onSelectProductTab) {
      onSelectProductTab(tab);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('select-product-tab', { detail: { tab } })
      );
    }
  };

  return (
    <section className="hero" aria-labelledby="hero-title">
      {/* Eyebrow */}
      <div className="hero-eyebrow">
        <div className="flex flex-col items-start gap-2 max-w-full">
          <span>TOKENIZED ASSETS. MORE POSSIBILITIES.</span>
          {tokenCA ? <CABadge address={tokenCA} truncate={false} /> : null}
        </div>
        <span>LEVIER / 01</span>
      </div>

      {/* 3D Rotating Stock Card Scene */}
      <StockCardScene
        markets={markets}
        onSelectAsset={onSelectMarketAsset}
      />

      {/* Motion row label */}
      <div className="motion-row">
        <span className="scene-caption">GLOBAL EQUITIES. ONCHAIN UTILITY.</span>
      </div>

      {/* Hero Bottom Layout */}
      <div className="hero-bottom">
        <div className="hero-copy">
          <a
            className="announcement"
            href="#products"
            onClick={() => handleSelectTab('borrow')}
          >
            <span>INTRODUCING</span> The Levier credit layer{' '}
            <span aria-hidden="true">↗</span>
          </a>

          <h1 id="hero-title">
            Your assets.
            <br />
            Your next <span>move.</span>
          </h1>

          <p>
            Leverage for tokenized assets on Robinhood Chain.
            <br className="desktop-break" /> Borrow, earn, and build exposure.
            All in one place.
          </p>
        </div>

        {/* Action Cards */}
        <div className="hero-actions">
          <a
            className="action-card"
            href="#products"
            onClick={() => handleSelectTab('borrow')}
          >
            <div>
              <h2>Unlock credit</h2>
              <span aria-hidden="true">↗</span>
            </div>
            <div className="action-bottom">
              <span>Keep your exposure.</span>
              <strong>Borrow against it.</strong>
            </div>
          </a>

          <a
            className="action-card accent-card"
            href="#products"
            onClick={() => handleSelectTab('leverage')}
          >
            <div>
              <h2>Go further</h2>
              <span aria-hidden="true">↗</span>
            </div>
            <div className="action-bottom">
              <span>Choose your direction.</span>
              <strong>Multiply your exposure.</strong>
            </div>
          </a>
        </div>
      </div>

      {/* Hero Footer */}
      <div className="hero-footer">
        <span>THE CREDIT + LEVERAGE LAYER</span>
        <a href="#products">
          Discover Levier <span aria-hidden="true">↓</span>
        </a>
        <span>DESIGNED FOR ONCHAIN FINANCE</span>
      </div>
    </section>
  );
}
