'use client';

import React, { useEffect, useRef, useState } from 'react';
import { assetCatalog } from '../lib/asset-catalog';
import { useNetworkMode } from '../hooks/useNetworkMode';

const FEATURED_MARKET_COUNT = assetCatalog.filter((asset) => asset.featured).length;

interface Stat {
  label: string;
  target?: number;
  decimals?: number;
  suffix?: string;
  staticValue?: string;
  primary?: boolean;
}

const STATS: Stat[] = [
  { label: 'Target equity markets', target: FEATURED_MARKET_COUNT, primary: true },
  { label: 'Max leverage', target: 2.5, decimals: 1, suffix: '×' },
  { label: 'Automated margin router', staticValue: '1-Click' },
];

function useCountUp(target: number | undefined, active: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === undefined) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!active || reduceMotion) {
      setValue(target);
      return;
    }

    const duration = 700;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setValue(target * progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);

  return value;
}

function StatItem({ stat, active, className }: { stat: Stat; active: boolean; className?: string }) {
  const value = useCountUp(stat.target, active);
  const display = stat.staticValue
    ? stat.staticValue
    : `${stat.decimals ? value.toFixed(stat.decimals) : Math.round(value)}${stat.suffix ?? ''}`;

  return (
    <div className={`stat-band-item ${className ?? ''}`.trim()}>
      <strong className="tabular-nums">{display}</strong>
      <span>{stat.label}</span>
    </div>
  );
}

export function StatBand() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { isTestnet } = useNetworkMode();
  const primary = STATS.find((stat) => stat.primary);
  // Mainnet markets are capped at 1.5x leverage at launch.
  const secondary = STATS.filter((stat) => !stat.primary).map((stat) =>
    stat.label === 'Max leverage' && !isTestnet ? { ...stat, target: 1.5 } : stat,
  );

  return (
    <section className="stat-band" aria-label="Levier at a glance">
      <div className="stat-band-inner section-wrap" ref={sectionRef}>
        <div className="stat-band-eyebrow">
          <span className="live-dot" aria-hidden="true" />
          <span>Live on Robinhood Chain {isTestnet ? 'testnet' : 'mainnet'}</span>
        </div>

        <div className="stat-band-row">
          {primary && <StatItem stat={primary} active={inView} className="stat-band-primary" />}

          <div className="stat-band-secondary">
            {secondary.map((stat) => (
              <StatItem key={stat.label} stat={stat} active={inView} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
