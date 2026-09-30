'use client';

import React from 'react';

const NODE_X = [167, 500, 833];
const RAIL_START = 40;
const RAIL_END = 960;

interface HowItWorksFlatProps {
  step: number;
  isMobile: boolean;
}

// Flat SVG version of the three steps. Used when WebGL is unavailable, motion is reduced, or the 3D scene fails.
export function HowItWorksFlat({ step, isMobile }: HowItWorksFlatProps) {
  const activeX = NODE_X[step];
  const progress = (activeX - RAIL_START) / (RAIL_END - RAIL_START);
  const viewBox = isMobile ? `${activeX - 180} 40 360 250` : '0 40 1000 250';
  const scene = (i: number) => `hiw-scene hiw-s${i + 1}${step === i ? ' is-active' : ''}`;

  return (
    <svg
      className="hiw-svg"
      viewBox={viewBox}
      role="img"
      aria-label="Shares go into a vault, USDG comes out to borrow or to open a Long or Short on a lever, and a guard cuts the position before health reaches liquidation."
    >
      {/* Line: rail, nodes and the traveling pulse */}
      <line className="hiw-rail" x1={RAIL_START} y1="270" x2={RAIL_END} y2="270" />
      <rect
        className="hiw-rail-on"
        x={RAIL_START}
        y="268.5"
        width={RAIL_END - RAIL_START}
        height="3"
        style={{ transform: `scaleX(${progress})` }}
      />
      {NODE_X.map((x, i) => (
        <circle key={x} className={`hiw-node${i <= step ? ' is-on' : ''}`} cx={x} cy="270" r="6" />
      ))}
      <circle
        className="hiw-pulse"
        cx={NODE_X[0]}
        cy="270"
        r="11"
        style={{ transform: `translateX(${activeX - NODE_X[0]}px)` }}
      />

      {/* 1. Deposit: shares drop into the vault */}
      <g className={scene(0)}>
        <path className="hiw-vault" d="M107 150 V246 H227 V150" />
        <circle className="hiw-chip" style={{ ['--i' as string]: 0 }} cx="147" cy="228" r="17" />
        <circle className="hiw-chip" style={{ ['--i' as string]: 1 }} cx="187" cy="228" r="17" />
        <circle className="hiw-chip" style={{ ['--i' as string]: 2 }} cx="167" cy="194" r="17" />
        <text className="hiw-label hiw-label-asset" x="167" y="126" textAnchor="middle">
          TSLA
        </text>
      </g>

      {/* 2. Borrow or trade: USDG comes out, lever tilts Long then Short */}
      <g className={scene(1)}>
        <polygon className="hiw-fulcrum" points="500,203 482,242 518,242" />
        <g className="hiw-beam">
          <rect className="hiw-ghost" x="380" y="140" width="240" height="120" />
          <rect className="hiw-beam-bar" x="380" y="197" width="240" height="6" rx="3" />
          <rect className="hiw-weight" x="384" y="171" width="46" height="26" rx="3" />
          <text className="hiw-label" x="407" y="188" textAnchor="middle">
            USDG
          </text>
          <rect className="hiw-weight is-lime" x="544" y="163" width="72" height="34" rx="3" />
          <text className="hiw-label is-dark" x="580" y="185" textAnchor="middle">
            1.25×
          </text>
        </g>
        <circle className="hiw-coin" style={{ ['--i' as string]: 0 }} cx="234" cy="205" r="8" />
        <circle className="hiw-coin" style={{ ['--i' as string]: 1 }} cx="234" cy="205" r="8" />
        <g className="hiw-side hiw-side-long">
          <path d="M468 122 V108 M462 114 L468 108 L474 114" />
          <text className="hiw-label" x="484" y="119">
            Long
          </text>
        </g>
        <g className="hiw-side hiw-side-short">
          <path d="M468 108 V122 M462 116 L468 122 L474 116" />
          <text className="hiw-label" x="484" y="119">
            Short
          </text>
        </g>
      </g>

      {/* 3. Auto-Protect: price dips, guard trims the position, health recovers */}
      <g className={scene(2)}>
        <path className="hiw-price" pathLength="1" d="M713 106 L773 114 L833 136 L893 168 L953 182" />
        <text className="hiw-label" x="713" y="204">
          Health
        </text>
        <rect className="hiw-track" x="713" y="214" width="240" height="12" rx="6" />
        <rect className="hiw-health" x="713" y="214" width="240" height="12" rx="6" />
        <line className="hiw-liq" x1="713" y1="208" x2="713" y2="232" />
        <line className="hiw-notch" x1="785" y1="208" x2="785" y2="232" />
        <g className="hiw-brackets">
          <path d="M705 208 h-8 v24 h8" />
          <path d="M961 208 h8 v24 h-8" />
        </g>
        <text className="hiw-label" x="713" y="252">
          Position
        </text>
        <rect className="hiw-position" x="770" y="246" width="183" height="6" rx="3" />
      </g>
    </svg>
  );
}
