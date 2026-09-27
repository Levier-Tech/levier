'use client';

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronLeft, ChevronRight, Grab } from 'lucide-react';
import { MarketConfig } from '@levera/types';
import { AssetLogo } from './AssetLogo';
import { MarketTrendChart } from './MarketTrendChart';

interface MarketCarouselProps {
  markets: MarketConfig[];
  isLoading?: boolean;
}

export function MarketCarousel({ markets, isLoading }: MarketCarouselProps) {
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drag-to-scroll state
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hasDragged, setHasDragged] = useState(false);

  // Navigation pagination state
  const [activeIndex, setActiveIndex] = useState(0);

  const categories = ['ALL', 'EQUITIES', 'ETFS'];

  const filteredMarkets = markets.filter((m) => {
    if (activeCategory === 'ALL') return true;
    return m.category.toUpperCase() === activeCategory;
  });

  const updateActiveIndex = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    const cardWidth = 360; // approximate card width + gap
    const index = Math.round(scrollLeft / cardWidth);
    setActiveIndex(Math.min(Math.max(index, 0), filteredMarkets.length - 1));
  };

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.addEventListener('scroll', updateActiveIndex);
    return () => scrollContainer.removeEventListener('scroll', updateActiveIndex);
  }, [filteredMarkets]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    setHasDragged(false);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollLeft(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5; // Scroll multiplier
    if (Math.abs(walk) > 5) {
      setHasDragged(true);
    }
    scrollRef.current.scrollLeft = scrollLeft - walk;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const scrollByCard = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 380;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const scrollToIndex = (index: number) => {
    if (!scrollRef.current) return;
    const cardWidth = 380;
    scrollRef.current.scrollTo({
      left: index * cardWidth,
      behavior: 'smooth',
    });
    setActiveIndex(index);
  };

  return (
    <div className="space-y-6 font-mono select-none">
      {/* Header controls: Filter Tabs & Navigation Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        {/* Category Filters */}
        <div className="flex items-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setActiveCategory(cat);
                setActiveIndex(0);
                if (scrollRef.current) scrollRef.current.scrollLeft = 0;
              }}
              className={`px-4 py-2 rounded-xs text-[11px] font-bold uppercase tracking-widest transition-all ${
                activeCategory === cat
                  ? 'bg-[#008000] text-white'
                  : 'bg-[#080908] text-[#8A8D88] hover:text-white border border-white/10'
              }`}
            >
              [{cat}]
            </button>
          ))}
        </div>

        {/* Drag Hint & Navigation Controls */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-[#8A8D88] uppercase tracking-wider">
            <Grab className="w-3.5 h-3.5 text-[#008000]" />
            <span>DRAG / SWIPE TO EXPLORE</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollByCard('left')}
              className="w-10 h-10 bg-[#080908] hover:bg-[#121412] text-white border border-white/10 hover:border-[#008000]/50 rounded-xs flex items-center justify-center transition-all disabled:opacity-30"
              aria-label="Previous markets"
            >
              <ChevronLeft className="w-5 h-5 text-[#8A8D88] hover:text-white" />
            </button>
            <button
              onClick={() => scrollByCard('right')}
              className="w-10 h-10 bg-[#080908] hover:bg-[#121412] text-white border border-white/10 hover:border-[#008000]/50 rounded-xs flex items-center justify-center transition-all disabled:opacity-30"
              aria-label="Next markets"
            >
              <ChevronRight className="w-5 h-5 text-[#8A8D88] hover:text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Carousel Track Container */}
      <div
        ref={scrollRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        className={`flex gap-6 overflow-x-auto scrollbar-none snap-x snap-mandatory py-2 px-0.5 ${
          isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        }`}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {isLoading ? (
          /* Loading Shimmer Skeleton Cards */
          [1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-[340px] sm:w-[370px] shrink-0 snap-start bg-[#080908] border border-white/10 rounded-sm p-6 flex flex-col justify-between space-y-6 animate-pulse"
            >
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-white/10" />
                    <div className="h-3.5 w-20 bg-white/10 rounded-xs" />
                  </div>
                  <div className="h-3.5 w-24 bg-[#008000]/20 rounded-xs" />
                </div>
                <div className="space-y-2">
                  <div className="h-6 w-3/4 bg-white/10 rounded-xs" />
                  <div className="h-8 w-1/2 bg-white/15 rounded-xs" />
                </div>
              </div>

              <div className="h-28 bg-[#050505] rounded-xs border border-white/5" />

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                <div className="h-12 bg-[#0b0d0b] rounded-xs" />
                <div className="h-12 bg-[#0b0d0b] rounded-xs" />
                <div className="h-12 bg-[#0b0d0b] rounded-xs" />
                <div className="h-12 bg-[#0b0d0b] rounded-xs" />
              </div>

              <div className="h-11 bg-white/10 rounded-xs" />
            </div>
          ))
        ) : filteredMarkets.length === 0 ? (
          /* Empty State */
          <div className="w-full py-16 px-8 bg-[#080908] border border-dashed border-white/10 rounded-sm text-center font-mono space-y-3">
            <span className="text-white font-bold block text-sm tracking-wider">[NO MARKETS FOUND]</span>
            <span className="text-xs text-[#555955] block">
              No tokenized equity or ETF pairs found for category &quot;{activeCategory}&quot;.
            </span>
            {activeCategory !== 'ALL' && (
              <button
                onClick={() => setActiveCategory('ALL')}
                className="px-3 py-1.5 text-[10px] bg-[#0b0d0b] border border-white/15 hover:border-[#008000] text-white rounded-sm uppercase tracking-wider transition-colors"
              >
                VIEW ALL MARKETS
              </button>
            )}
          </div>
        ) : (
          /* Live Carousel Cards */
          filteredMarkets.map((market) => (
            <div
              key={market.id}
              className="w-[340px] sm:w-[370px] shrink-0 snap-start bg-[#080908] border border-white/10 rounded-sm p-6 flex flex-col justify-between space-y-6 group hover:border-[#008000]/50 hover:shadow-[0_0_25px_rgba(0,128,0,0.15)] transition-all duration-300 relative"
            >
              {/* Card Top Info */}
              <div className="space-y-4">
                <div className="flex justify-between items-center text-[10px] text-[#8A8D88] uppercase tracking-widest">
                  <div className="flex items-center gap-2">
                    <AssetLogo symbol={market.assetSymbol} size="sm" />
                    <span className="font-bold text-white">[{market.assetSymbol}]</span>
                    <span className="text-[#8A8D88]">[{market.category}]</span>
                  </div>
                  <span className="text-[#008000] font-bold">[ISOLATED PAIR]</span>
                </div>

                <div>
                  <h3 className="text-2xl font-normal text-white uppercase tracking-tight group-hover:text-[#008000] transition-colors font-sans">
                    {market.name}
                  </h3>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-bold font-mono text-white">
                      ${market.markPrice.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-[#8A8D88] uppercase tracking-wider">
                      MARK PRICE
                    </span>
                  </div>
                </div>
              </div>

              {/* Sparkline Trend Chart Preview */}
              <div className="bg-[#050505] border border-white/5 p-3 rounded-xs group-hover:border-white/10 transition-colors">
                <MarketTrendChart symbol={market.assetSymbol} />
              </div>

              {/* Metrics Breakdown */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10 text-xs">
                <div className="bg-[#0b0d0b] p-2.5 rounded-xs border border-white/5">
                  <span className="text-[10px] text-[#8A8D88] block uppercase">BORROW APR</span>
                  <span className="text-sm font-bold text-[#FFB800]">
                    {market.borrowApr.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#0b0d0b] p-2.5 rounded-xs border border-white/5">
                  <span className="text-[10px] text-[#8A8D88] block uppercase">MAX LTV</span>
                  <span className="text-sm font-bold text-white">
                    {market.maxLtv.toFixed(0)}%
                  </span>
                </div>

                <div className="bg-[#0b0d0b] p-2.5 rounded-xs border border-white/5">
                  <span className="text-[10px] text-[#8A8D88] block uppercase">SUPPLY APY</span>
                  <span className="text-sm font-bold text-[#008000]">
                    +{market.supplyApy.toFixed(2)}%
                  </span>
                </div>

                <div className="bg-[#0b0d0b] p-2.5 rounded-xs border border-white/5">
                  <span className="text-[10px] text-[#8A8D88] block uppercase">LIQUIDITY</span>
                  <span className="text-sm font-bold text-white">
                    ${(market.availableLiquidityUsd / 1000).toFixed(0)}K
                  </span>
                </div>
              </div>

              {/* Interactive CTA */}
              <div className="pt-2">
                <Link
                  href={`/trade?asset=${market.assetSymbol}`}
                  onClick={(e) => {
                    if (hasDragged) e.preventDefault();
                  }}
                  className="w-full py-3 px-4 bg-[#008000] hover:bg-[#009900] text-white font-mono font-bold text-xs uppercase tracking-widest rounded-xs transition-all flex items-center justify-center gap-2 group-hover:shadow-[0_0_15px_rgba(0,128,0,0.4)]"
                >
                  <span>TRADE / BORROW {market.assetSymbol}</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Slide Pagination Dots */}
      <div className="flex items-center justify-center gap-2 pt-2">
        {filteredMarkets.length > 0 &&
          filteredMarkets.map((_, idx) => (
            <button
              key={idx}
              onClick={() => scrollToIndex(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                activeIndex === idx
                  ? 'w-8 bg-[#008000]'
                  : 'w-2 bg-white/20 hover:bg-white/40'
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
      </div>
    </div>
  );
}
