'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useRef, useState } from 'react';

import { hasWebGL } from '../lib/webgl';
import { HowItWorksFlat } from './HowItWorksFlat';

// three.js only loads once the section has scrolled into view.
const HowItWorksScene = dynamic(() => import('./HowItWorksScene'), { ssr: false });

const STEPS = [
  { label: 'Deposit', caption: 'Lock TSLA as collateral' },
  { label: 'Borrow or trade', caption: 'Borrow USDG, or go Long or Short' },
  { label: 'Auto-Protect', caption: 'Auto-Protect trims risk before liquidation' },
];
const STEP_MS = 5000;

export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setWebgl(hasWebGL());
  }, []);

  // Narrow screens show a crop of the flat drawing centered on the active scene.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // The loop only runs while the section is on screen; re-entering resumes it.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0].isIntersecting;
        setInView(visible);
        if (visible) {
          setRevealed(true);
          setPaused(false);
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || paused || reduceMotion) return;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [inView, paused, reduceMotion, step]);

  const goTo = (next: number, focus = false) => {
    setPaused(true);
    setTouched(true);
    setStep(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onTabKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo((index + 1) % STEPS.length, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo((index + STEPS.length - 1) % STEPS.length, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(STEPS.length - 1, true);
    }
  };

  // 3D by default. Reduced motion, no WebGL, or a lost context falls back to the flat drawing.
  const flat = reduceMotion || webgl === false || sceneFailed;
  const timed = inView && !paused && !reduceMotion;

  return (
    <section
      ref={sectionRef}
      className="hiw section-wrap"
      id="how-it-works"
      aria-labelledby="how-it-works-title"
    >
      <div className="section-topline">
        <span>02 / THE MECHANICS</span>
        <span>HOW A POSITION WORKS</span>
      </div>
      <h2 className="section-title" id="how-it-works-title">
        Deposit. Borrow.{' '}
        <br className="hiw-br" />
        <span>Stay protected.</span>
      </h2>

      <div
        className={`hiw-stage${revealed ? ' is-playing' : ''}`}
        id="hiw-stage"
        role="tabpanel"
        aria-labelledby={`hiw-tab-${step}`}
      >
        {flat ? (
          <HowItWorksFlat step={step} isMobile={isMobile} />
        ) : (
          <div
            className="hiw-visual"
            role="img"
            aria-label="A 3D drawing of one position. Shares drop into a vault, USDG comes out to borrow, the position grows to 1.25 times for a Long or Short, and a guard trims it before the liquidation line reaches it."
          >
            {revealed && webgl && (
              <HowItWorksScene step={step} active={inView} onFail={() => setSceneFailed(true)} />
            )}
          </div>
        )}

        <p className="hiw-caption" key={step}>
          {STEPS[step].caption}
          {step === 2 && <span className="hiw-testnet">Testnet</span>}
        </p>

        <div
          className="hiw-tabs"
          role="tablist"
          aria-label="Steps"
          style={{ ['--hiw-step' as string]: `${STEP_MS}ms` }}
        >
          {STEPS.map((s, i) => (
            <button
              key={s.label}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`hiw-tab-${i}`}
              aria-selected={step === i}
              aria-controls="hiw-stage"
              tabIndex={step === i ? 0 : -1}
              className={`hiw-tab${step === i ? ' is-active' : ''}${step === i && timed ? ' is-timed' : ''}`}
              onClick={() => goTo(i)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          {touched ? STEPS[step].caption : ''}
        </span>
      </div>
    </section>
  );
}
