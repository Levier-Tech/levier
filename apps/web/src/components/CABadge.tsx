'use client';

import React, { useState } from 'react';

interface CABadgeProps {
  address?: string;
  className?: string;
  truncate?: boolean;
}

export function CABadge({ address, className = '', truncate = false }: CABadgeProps) {
  const [copied, setCopied] = useState(false);

  if (!address || typeof address !== 'string' || !address.trim()) {
    return null;
  }

  const cleanAddress = address.trim();
  const formattedAddress = truncate
    ? (cleanAddress.length > 14
        ? `${cleanAddress.slice(0, 6)}...${cleanAddress.slice(-4)}`
        : cleanAddress)
    : cleanAddress;

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(cleanAddress);
      } else {
        // Fallback for older browsers / environments
        const textArea = document.createElement('textarea');
        textArea.value = cleanAddress;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy CA:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard!' : `Copy Contract Address: ${cleanAddress}`}
      aria-label={copied ? 'CA copied to clipboard' : `Copy Contract Address: ${cleanAddress}`}
      className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 rounded-full bg-[#11160e]/95 border border-[#2a3723] hover:border-[var(--green)] hover:bg-[#172014] text-[10px] sm:text-[11px] font-mono transition-all cursor-pointer select-none group shadow-[0_2px_8px_rgba(0,0,0,0.5)] max-w-full text-left ${className}`}
    >
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-60"></span>
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--green)]"></span>
      </span>

      <span className="text-[#849177] font-semibold text-[9px] sm:text-[10px] tracking-wider uppercase shrink-0">
        CA:
      </span>

      <span className="text-[#d7e0ce] group-hover:text-white font-medium transition-colors break-all">
        {formattedAddress}
      </span>

      <span className="inline-flex items-center ml-0.5 shrink-0">
        {copied ? (
          <span className="flex items-center gap-1 text-[var(--green)] text-[10px] font-semibold animate-in fade-in zoom-in-95 duration-150">
            <svg
              className="w-3 h-3 stroke-[2.5]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>Copied!</span>
          </span>
        ) : (
          <svg
            className="w-3 h-3 text-[#77836b] group-hover:text-[var(--green)] transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <rect
              x="9"
              y="9"
              width="13"
              height="13"
              rx="2"
              ry="2"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
