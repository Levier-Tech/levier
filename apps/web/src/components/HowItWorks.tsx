'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

type Side = 'borrow' | 'long' | 'short';

const STATION_X = [200, 600, 1000];
const RAIL_START = 40;
const RAIL_END = 1160;
const BEAM_LEFT = 420;
const BEAM_LENGTH = 360;
const MARGIN = 2; // USDG, matches the testnet examples used in the app copy

// Exposure options and beam tilt (degrees) offered by the testnet margin router.
const EXPOSURE: Record<Side, number[]> = {
  borrow: [1],
  long: [1.25, 1.5],
  short: [1, 1.25],
};
const TILT: Record<Side, Record<number, number>> = {
  borrow: { 1: 0 },
  long: { 1.25: -5, 1.5: -8 },
  short: { 1: 3, 1.25: 6 },
};

const STEPS = [
  {
    title: 'Deposit TSLA',
    hint: 'Collateral goes into its own market',
    body: 'Deposit tokenized TSLA as collateral in its own market on Robinhood Chain. Each market is isolated, so trouble in one never reaches another.',
  },
  {
    title: 'Borrow or trade',
    hint: 'Borrow USDG or open a Long or Short',
    body: 'Borrow USDG against your collateral, or put up USDG margin and open a Long or Short in one transaction. The lever above shows how exposure grows with the multiple you pick.',
  },
  {
    title: 'Set a guard',
    hint: 'Cut risk before liquidation',
    body: 'Pick a safety threshold. Auto-Protect is built so keepers cut your position before it reaches liquidation. It is in testnet preview, so this drawing shows the intended behavior.',
  },
];

const HEALTH_START = 1.6;
const HEALTH_TRIGGER = 1.15;
const HEALTH_MAX = 1.8;
const GUARD_CUT = 0.7; // guard keeps 70% of the position

const trim = (n: number) => String(Number(n.toFixed(2)));

export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [side, setSide] = useState<Side>('long');
  const [exposure, setExposure] = useState(1.25);
  const [drop, setDrop] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const timers = useRef<number[]>([]);
  const interacted = useRef(false);
  const started = useRef(false);

  const stopAutoplay = useCallback(() => {
    interacted.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  // Narrow screens show a crop of the drawing centered on the active station.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // One pass through the three stations when the section first scrolls into view.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || started.current) return;
        started.current = true;
        setRevealed(true);
        if (reduceMotion) return;
        [1700, 3400].forEach((delay, i) => {
          timers.current.push(
            window.setTimeout(() => {
              if (!interacted.current) setStep(i + 1);
            }, delay),
          );
        });
        timers.current.push(
          window.setTimeout(() => {
            if (!interacted.current) setStep(1);
          }, 5200),
        );
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const goTo = (next: number, focus = false) => {
    stopAutoplay();
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

  const chooseSide = (next: Side) => {
    stopAutoplay();
    setSide(next);
    setExposure(EXPOSURE[next][0]);
  };

  // Lever geometry: the fulcrum sits closer to the margin end as exposure rises.
  const armLeft = BEAM_LENGTH / (1 + exposure);
  const beamShift = BEAM_LENGTH / 2 - armLeft; // fulcrum stays under the rail marker; the beam slides over it
  const tilt = TILT[side][exposure] ?? 0;
  const total = MARGIN * exposure;
  const debt = (exposure - 1) * MARGIN;
  const rightWeightW = 52 + (exposure - 1) * 60;

  // Guard illustration.
  const rawHealth = HEALTH_START * (1 - drop / 100);
  const guarded = rawHealth < HEALTH_TRIGGER;
  const health = guarded ? rawHealth / GUARD_CUT : rawHealth;
  const healthFrac = Math.max(0, Math.min(1, (health - 1) / (HEALTH_MAX - 1)));
  const triggerFrac = (HEALTH_TRIGGER - 1) / (HEALTH_MAX - 1);
  const priceEndY = 130 + drop * 2.2;

  const activeX = STATION_X[step];
  const progress = (activeX - RAIL_START) / (RAIL_END - RAIL_START);
  const viewBox = isMobile ? `${activeX - 220} 90 440 240` : '0 90 1200 240';

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
        From shares to a
        <br />
        <span>protected position.</span>
      </h2>

      <div className="hiw-stage">
        <svg
          className={`hiw-svg${revealed ? ' is-revealed' : ''}`}
          viewBox={viewBox}
          role="img"
          aria-label="A horizontal drawing of a position moving from a vault of deposited shares, across a lever that sets exposure, to a health gauge with a guard."
        >
          {/* Rail */}
          <line className="hiw-rail" x1={RAIL_START} y1="305" x2={RAIL_END} y2="305" />
          <rect
            className="hiw-rail-on"
            x={RAIL_START}
            y="303.5"
            width={RAIL_END - RAIL_START}
            height="3"
            style={{ transform: `scaleX(${progress})` }}
          />
          {STATION_X.map((x, i) => (
            <circle
              key={x}
              className={`hiw-node${i <= step ? ' is-on' : ''}`}
              cx={x}
              cy="305"
              r="7"
            />
          ))}
          <circle
            className="hiw-pulse"
            cx={RAIL_START}
            cy="305"
            r="11"
            style={{ transform: `translateX(${activeX - RAIL_START}px)` }}
          />

          {/* Station 1: vault and dropped share slabs */}
          <g className={`hiw-vault${step === 0 ? ' is-active' : ''}`}>
            <rect className="hiw-outline" x="130" y="176" width="140" height="112" rx="4" />
            <line className="hiw-outline" x1="130" y1="204" x2="270" y2="204" />
            <rect className="hiw-outline" x="176" y="188" width="48" height="6" rx="3" />
            <g className="hiw-slabs">
              <rect className="hiw-slab" x="152" y="262" width="96" height="14" rx="2" />
              <rect className="hiw-slab" x="152" y="244" width="96" height="14" rx="2" />
              <rect className="hiw-slab" x="152" y="226" width="96" height="14" rx="2" />
              <text className="hiw-svg-text hiw-slab-label" x="200" y="236" textAnchor="middle">
                TSLA
              </text>
            </g>
          </g>

          {/* Station 2: the lever */}
          <g className={`hiw-lever${step === 1 ? ' is-active' : ''}`}>
            <polygon
              className="hiw-fulcrum-shape"
              points={`${STATION_X[1]},246 ${STATION_X[1] - 26},298 ${STATION_X[1] + 26},298`}
            />
            <g
              className="hiw-beam"
              style={{
                transformOrigin: `${STATION_X[1]}px 240px`,
                transform: `rotate(${tilt}deg)`,
              }}
            >
              <g className="hiw-slide" style={{ transform: `translateX(${beamShift}px)` }}>
                <rect className="hiw-beam-bar" x={BEAM_LEFT} y="237" width={BEAM_LENGTH} height="6" rx="3" />
                <rect className="hiw-weight" x={BEAM_LEFT + 6} y="195" width="52" height="40" rx="3" />
                <text className="hiw-svg-text" x={BEAM_LEFT + 32} y="219" textAnchor="middle">
                  {side === 'borrow' ? 'TSLA' : `${trim(MARGIN)} USDG`}
                </text>
                <g style={{ transform: `translateX(${BEAM_LENGTH - 12 - rightWeightW}px)` }} className="hiw-slide">
                  <rect
                    className="hiw-weight is-lime"
                    x={BEAM_LEFT + 6}
                    y="195"
                    width={rightWeightW}
                    height="40"
                    rx="3"
                  />
                  <text className="hiw-svg-text is-dark" x={BEAM_LEFT + 6 + rightWeightW / 2} y="219" textAnchor="middle">
                    {side === 'borrow' ? 'USDG' : `${trim(total)} USDG`}
                  </text>
                </g>
              </g>
            </g>
          </g>

          {/* Station 3: price, health gauge, guard */}
          <g className={`hiw-gauge${step === 2 ? ' is-active' : ''}${guarded ? ' is-guarded' : ''}`}>
            <polyline
              className="hiw-price"
              points={`860,130 940,${130 + drop * 0.7} 1020,${130 + drop * 1.4} 1100,${priceEndY} `}
            />
            <circle className="hiw-price-dot" cx="1100" cy={priceEndY} r="4" />
            <text className="hiw-svg-text" x="860" y="112">
              TSLA price
            </text>
            <rect className="hiw-track" x="850" y="232" width="300" height="14" rx="7" />
            <rect
              className="hiw-health"
              x="850"
              y="232"
              width="300"
              height="14"
              rx="7"
              style={{ transform: `scaleX(${healthFrac})` }}
            />
            <line
              className="hiw-notch"
              x1={850 + 300 * triggerFrac}
              y1="222"
              x2={850 + 300 * triggerFrac}
              y2="256"
            />
            <text className="hiw-svg-text" x={850 + 300 * triggerFrac} y="274" textAnchor="middle">
              guard
            </text>
            <line className="hiw-liq" x1="850" y1="222" x2="850" y2="256" />
            <text className="hiw-svg-text is-danger" x="850" y="274" textAnchor="middle">
              liquidation
            </text>
            <g className="hiw-brackets">
              <path d="M842 226 h-10 v26 h10" />
              <path d="M1158 226 h10 v26 h-10" />
            </g>
          </g>
        </svg>
      </div>

      <div className="hiw-tabs" role="tablist" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`hiw-tab-${i}`}
            aria-selected={step === i}
            aria-controls="hiw-panel"
            tabIndex={step === i ? 0 : -1}
            className={`hiw-tab${step === i ? ' is-active' : ''}`}
            onClick={() => goTo(i)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            <span className="hiw-tab-num">{i + 1}</span>
            <span className="hiw-tab-title">{s.title}</span>
            <span className="hiw-tab-hint">{s.hint}</span>
          </button>
        ))}
      </div>

      <div
        className="hiw-panel"
        id="hiw-panel"
        role="tabpanel"
        aria-labelledby={`hiw-tab-${step}`}
        aria-live="polite"
      >
        <p className="hiw-body">{STEPS[step].body}</p>

        {step === 0 && (
          <dl className="hiw-facts">
            <div>
              <dt>Market</dt>
              <dd>TSLA / USDG</dd>
            </div>
            <div>
              <dt>Borrow limit</dt>
              <dd>50% of collateral value</dd>
            </div>
            <div>
              <dt>Liquidation at</dt>
              <dd>65% of collateral value</dd>
            </div>
          </dl>
        )}

        {step === 1 && (
          <div className="hiw-controls">
            <div className="hiw-control">
              <span className="hiw-control-label" id="hiw-side-label">
                What do you want to do
              </span>
              <div className="hiw-seg" role="radiogroup" aria-labelledby="hiw-side-label">
                {(['borrow', 'long', 'short'] as Side[]).map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={side === s}
                    className={side === s ? 'is-active' : ''}
                    onClick={() => chooseSide(s)}
                  >
                    {s === 'borrow' ? 'Borrow' : s === 'long' ? 'Long' : 'Short'}
                  </button>
                ))}
              </div>
            </div>
            {side !== 'borrow' && (
              <div className="hiw-control">
                <span className="hiw-control-label" id="hiw-exp-label">
                  Exposure per USDG of margin
                </span>
                <div className="hiw-seg" role="radiogroup" aria-labelledby="hiw-exp-label">
                  {EXPOSURE[side].map((e) => (
                    <button
                      key={e}
                      role="radio"
                      aria-checked={exposure === e}
                      className={exposure === e ? 'is-active' : ''}
                      onClick={() => {
                        stopAutoplay();
                        setExposure(e);
                      }}
                    >
                      {e.toFixed(2).replace(/0$/, '')}×
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="hiw-readout">
              {side === 'borrow' &&
                'Deposit TSLA, then borrow USDG against it. The lever stays level because you take out a loan, not extra exposure.'}
              {side === 'long' &&
                `${trim(MARGIN)} USDG of margin at ${trim(exposure)}× buys ${trim(total)} USDG of TSLA. You borrow ${trim(debt)} USDG, and the position gains if TSLA rises.`}
              {side === 'short' &&
                `${trim(MARGIN)} USDG of margin at ${trim(exposure)}× sells ${trim(total)} USDG of borrowed TSLA. The position gains if TSLA falls.`}
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="hiw-controls">
            <div className="hiw-control">
              <label className="hiw-control-label" htmlFor="hiw-drop">
                TSLA falls by {drop}%
              </label>
              <input
                id="hiw-drop"
                className="hiw-range"
                type="range"
                min={0}
                max={40}
                step={1}
                value={drop}
                onChange={(e) => {
                  stopAutoplay();
                  setDrop(Number(e.target.value));
                }}
              />
            </div>
            <p className="hiw-readout">
              Health {health.toFixed(2)}.{' '}
              {guarded
                ? 'The guard fired and cut the position by 30%, so health recovers before liquidation.'
                : drop === 0
                  ? 'Drag the slider to drop the price and watch health fall toward the guard.'
                  : 'Health is falling. The guard acts when it reaches the marked threshold.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
