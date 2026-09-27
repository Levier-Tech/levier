'use client';

import React, { useState } from 'react';

interface MarketTrendChartProps {
  symbol: string;
  change24h?: number;
  height?: number;
  width?: number;
  className?: string;
}

const PRESET_TREND_DATA: Record<string, { points: number[]; change24h: number }> = {
  NVDA: { points: [238, 240, 239, 244, 242, 247, 250], change24h: 5.42 },
  AAPL: { points: [225, 226, 224, 227, 229, 228, 230.5], change24h: 2.18 },
  TSLA: { points: [228, 225, 226, 221, 220, 218, 215.8], change24h: -3.25 },
  WETH: { points: [3300, 3320, 3310, 3380, 3370, 3420, 3450], change24h: 4.12 },
  SPCX: { points: [171, 173, 172, 178, 180, 182, 185], change24h: 7.85 },
  PONS: { points: [43.8, 43.5, 43.9, 43.1, 42.8, 42.9, 42.5], change24h: -1.80 },
  AMZN: { points: [180.2, 181.5, 180.8, 183.4, 184.2, 185.0, 186.2], change24h: 3.10 },
  META: { points: [482, 488.5, 492, 498, 504, 508, 512.4], change24h: 6.25 },
  BABA: { points: [87.2, 86.5, 86.8, 85.1, 85.4, 84.9, 84.6], change24h: -2.40 },
  NFLX: { points: [652, 658, 660.5, 668.2, 674, 680, 685.1], change24h: 4.90 },
  SPY: { points: [552, 554.1, 553.5, 556.8, 558, 559.2, 560.2], change24h: 1.45 },
};

export function MarketTrendChart({
  symbol,
  change24h: customChange,
  height = 90,
  width = 280,
  className = '',
}: MarketTrendChartProps) {
  const preset = PRESET_TREND_DATA[symbol.toUpperCase()] || {
    points: [100, 101, 99.5, 102, 103, 102.5, 104],
    change24h: 4.0,
  };

  const points = preset.points;
  const change24h = customChange ?? preset.change24h;
  const isPositive = change24h >= 0;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const minVal = Math.min(...points);
  const maxVal = Math.max(...points);
  const range = maxVal - minVal || 1;

  const paddingY = 12;
  const chartHeight = height - paddingY * 2;
  const stepX = width / (points.length - 1);

  const coords = points.map((val, idx) => {
    const x = idx * stepX;
    const norm = (val - minVal) / range;
    const y = height - paddingY - norm * chartHeight;
    return { x, y, val };
  });

  // Construct smooth curve using cubic bezier path
  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const current = coords[i];
    const next = coords[i + 1];
    const cp1x = current.x + stepX / 2;
    const cp1y = current.y;
    const cp2x = current.x + stepX / 2;
    const cp2y = next.y;
    pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`;
  }

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  const strokeColor = isPositive ? '#008000' : '#FF4949';
  const gradientId = `trend-gradient-${symbol}-${Math.random().toString(36).substring(2, 7)}`;

  return (
    <div className={`relative w-full ${className}`}>
      {/* 24h Change Badge Header */}
      <div className="flex justify-between items-center text-[11px] font-mono mb-2">
        <span className="text-[#8A8D88] uppercase tracking-wider text-[10px]">7D PRICE TREND</span>
        <div
          className={`flex items-center gap-1 font-bold px-2 py-0.5 rounded-xs border text-[10px] ${
            isPositive
              ? 'text-[#008000] bg-[#008000]/10 border-[#008000]/30'
              : 'text-[#FF4949] bg-[#FF4949]/10 border-[#FF4949]/30'
          }`}
        >
          <span>{isPositive ? '▲' : '▼'}</span>
          <span>
            {isPositive ? '+' : ''}
            {change24h.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* SVG Container */}
      <div className="relative w-full h-[90px] overflow-hidden group">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>

            <filter id={`glow-${symbol}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Grid horizontal lines */}
          <line x1="0" y1={height * 0.3} x2={width} y2={height * 0.3} stroke="#ffffff" strokeOpacity="0.04" strokeDasharray="3 3" />
          <line x1="0" y1={height * 0.7} x2={width} y2={height * 0.7} stroke="#ffffff" strokeOpacity="0.04" strokeDasharray="3 3" />

          {/* Gradient Area */}
          <path d={areaD} fill={`url(#${gradientId})`} />

          {/* Glowing Line */}
          <path
            d={pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${symbol})`}
          />

          {/* Hover interactive zones & points */}
          {coords.map((pt, idx) => (
            <g key={idx}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={hoverIndex === idx ? '4' : '2'}
                fill={hoverIndex === idx ? strokeColor : '#050505'}
                stroke={strokeColor}
                strokeWidth="1.5"
                className="transition-all duration-150"
              />

              {/* Invisible touch/hover target */}
              <rect
                x={pt.x - stepX / 2}
                y="0"
                width={stepX}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(idx)}
              />
            </g>
          ))}
        </svg>

        {/* Hover Tooltip display */}
        {hoverIndex !== null && (
          <div
            className="absolute top-1 font-mono text-[9px] bg-[#050505] border border-white/20 px-2 py-0.5 rounded text-white shadow-lg pointer-events-none transform -translate-x-1/2 z-10"
            style={{
              left: `${(coords[hoverIndex].x / width) * 100}%`,
            }}
          >
            ${coords[hoverIndex].val.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}
