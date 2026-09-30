'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HeroSound } from './hero-race/audio';
import { MarketConfig } from '@levier/types';

import { assetCatalog, marketPath } from '../lib/asset-catalog';
import { hasWebGL } from '../lib/webgl';
import { useReferencePrices } from '../hooks/useReferencePrices';
import { EmptyPriceValue } from './EmptyPriceValue';
import { riderSpec } from './hero-race/config';
import { StockCardScene } from './StockCardScene';

// three.js and the race scene load only after the page is idle.
const HeroRaceScene = dynamic(() => import('./HeroRaceScene'), { ssr: false });

interface HeroRaceProps {
  markets?: MarketConfig[];
  onSelectAsset?: (ticker: string) => void;
}

// Cinematic MotoGP loop with a live-price leaderboard. The stock-card carousel is only the fallback for devices
// that cannot run the scene (no WebGL, reduced motion, lost context); while the scene loads the stage stays dark.
export function HeroRace({ markets, onSelectAsset }: HeroRaceProps) {
  const router = useRouter();
  const references = useReferencePrices();
  const riders = useMemo(() => assetCatalog.filter((a) => a.featured).slice(0, 5).map(riderSpec), []);

  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [inView, setInView] = useState(true);
  const [logo, setLogo] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const audio = useRef<HeroSound | null>(null);

  // Remembered volume (per browser); storage may be unavailable.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem('levier-hero-volume'));
      if (saved > 0 && saved <= 1) setVolume(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // Sound needs a click (browser autoplay rules). The sound files load on first use.
  const toggleSound = async () => {
    const next = !soundOn;
    setSoundOn(next);
    if (next && !audio.current) {
      const { HeroSound } = await import('./hero-race/audio');
      audio.current = new HeroSound();
      audio.current.setVolume(volume);
    }
    await audio.current?.setEnabled(next);
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    audio.current?.setVolume(next);
    try {
      window.localStorage.setItem('levier-hero-volume', String(next));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => () => audio.current?.dispose(), []);

  // Pause the sound with the film: off screen or in a hidden tab.
  useEffect(() => {
    const sync = () => audio.current?.pause(!inView || document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [inView, soundOn]);
  const [order, setOrder] = useState<number[]>(() => riders.map((_, i) => i));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !hasWebGL() || riders.length < 5) {
      setFallback(true);
      return;
    }
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(() => setLoad(true), { timeout: 1500 }) : window.setTimeout(() => setLoad(true), 400);
    return () => {
      if (idle) (window as unknown as { cancelIdleCallback: (n: number) => void }).cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, [riders.length]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => setInView(entries[0].isIntersecting), { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const onFail = useCallback(() => {
    setFailed(true);
    setReady(false);
    setFallback(true);
  }, []);
  const onOrder = useCallback((next: number[]) => setOrder(next), []);
  const onLogo = useCallback((next: boolean) => setLogo(next), []);

  const open = (ticker: string) => {
    if (onSelectAsset) onSelectAsset(ticker);
    else router.push(marketPath(ticker));
  };

  return (
    <div className="hero-race" ref={wrapRef}>
      {fallback && (
        <div className="hero-race-cards">
          <StockCardScene markets={markets} onSelectAsset={onSelectAsset} />
        </div>
      )}

      {load && !failed && (
        <div className={`hero-race-stage${ready ? ' is-ready' : ''}`}>
          <HeroRaceScene riders={riders} active={inView} onReady={onReady} onFail={onFail} onOrder={onOrder} onLogo={onLogo} sound={audio} />
        </div>
      )}

      {ready && !failed && (
        <>
          <p className="sr-only">
            Animated MotoGP race between five riders wearing the Tesla, Amazon, Palantir, Netflix and AMD logos. The winner crosses
            the finish line, then the Levier logo appears and the loop restarts. The standings below link to each market.
          </p>
          <div className={`hero-race-sound${soundOn ? ' is-on' : ''}`}>
            <button type="button" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? 'Mute race sound' : 'Play race sound'}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                {soundOn ? (
                  <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                ) : (
                  <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                )}
              </svg>
              <span>{soundOn ? 'Sound on' : 'Sound off'}</span>
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Race sound volume"
              style={{ ['--fill' as string]: `${Math.round(volume * 100)}%` }}
            />
          </div>
          <ol className={`hero-race-board${logo ? ' is-hidden' : ''}`} aria-label="Race standings with reference prices">
            {order.map((bike, place) => {
              const r = riders[bike];
              const price = references.price(r.ticker);
              return (
                <li key={r.ticker}>
                  <button type="button" onClick={() => open(r.ticker)} aria-label={`View ${r.name} market`}>
                    <span className="place">P{place + 1}</span>
                    <span>{r.ticker}</span>
                    <span className="price">{price ?? (references.pending ? '…' : <EmptyPriceValue />)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
