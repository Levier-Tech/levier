"use client";

import React, { useState, useEffect, useMemo } from "react";

/**
 * Generate deterministic theme colors from a token symbol.
 */
export function getSymbolTheme(symbol: string) {
  // Levera uses a sleek minimal palette, avoiding random rainbow hues.
  return {
    bg: "#141513",
    border: "#292a27",
    text: "var(--text)",
    glow: "transparent",
  };
}

/**
 * Format raw image URL or IPFS URI into standard public URL.
 */
export function normalizeTokenImageUrl(url?: string | null): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.replace("ipfs://", "")}`;
  }
  if (trimmed.startsWith("ipfs/")) {
    return `https://ipfs.io/ipfs/${trimmed.replace("ipfs/", "")}`;
  }
  return trimmed;
}

interface TokenLogoProps {
  src?: string | null;
  symbol: string;
  size?: number;
  className?: string;
  showPonsBadge?: boolean;
}

/**
 * Resilient Token Logo component:
 * 1. Attempts direct image load without CORS restrictions (no-cors default).
 * 2. Uses referrerPolicy="no-referrer" to unblock Twitter/CDN hotlink protection.
 * 3. On direct failure, falls back to server-side multi-gateway image proxy (/api/proxy/image).
 * 4. On final failure or empty image, displays a sleek deterministic monogram avatar.
 */
export function TokenLogo({
  src,
  symbol,
  size = 40,
  className = "",
  showPonsBadge = false,
}: TokenLogoProps) {
  const directUrl = useMemo(() => normalizeTokenImageUrl(src), [src]);
  
  // Stages: "direct" -> "proxy" -> "fallback"
  const [stage, setStage] = useState<"direct" | "proxy" | "fallback">(
    directUrl ? "direct" : "fallback"
  );

  useEffect(() => {
    const next = normalizeTokenImageUrl(src);
    setStage(next ? "direct" : "fallback");
  }, [src]);

  const theme = useMemo(() => getSymbolTheme(symbol), [symbol]);

  const handleError = () => {
    if (stage === "direct" && directUrl) {
      setStage("proxy");
    } else {
      setStage("fallback");
    }
  };

  const ponsBadgeSize = Math.max(18, Math.floor(size * 0.45));
  const ponsBadge = showPonsBadge ? (
    <img
      src="/assets/logo_pons.png"
      alt="Pons"
      style={{
        position: "absolute",
        bottom: -1,
        right: -1,
        width: ponsBadgeSize,
        height: ponsBadgeSize,
        borderRadius: "50%",
        border: "2px solid #111",
        background: "#111",
        objectFit: "cover",
      }}
    />
  ) : null;

  if (stage === "fallback" || !directUrl) {
    return (
      <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
        <div
          className={`asset-logo flex items-center justify-center font-bold uppercase select-none transition-all ${className}`}
          style={{
            width: size,
            height: size,
            fontSize: Math.max(10, Math.floor(size * 0.35)),
          }}
          title={symbol}
        >
          {symbol.slice(0, 4)}
        </div>
        {ponsBadge}
      </div>
    );
  }

  const activeSrc =
    stage === "proxy"
      ? `/api/proxy/image?url=${encodeURIComponent(directUrl)}`
      : directUrl;

  return (
    <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <img
        src={activeSrc}
        alt={symbol}
        onError={handleError}
        referrerPolicy="no-referrer"
        loading="lazy"
        className={`rounded-full object-cover shrink-0 bg-[#0c0d0c] ring-1 ring-white/10 ${className}`}
        style={{ width: size, height: size }}
      />
      {ponsBadge}
    </div>
  );
}

/**
 * Resilient ambient card background overlay:
 * Smoothly falls back to radial glow if the background image cannot be loaded.
 */
export function TokenBackgroundOverlay({
  src,
  symbol,
}: {
  src?: string | null;
  symbol: string;
}) {
  const directUrl = useMemo(() => normalizeTokenImageUrl(src), [src]);
  const [stage, setStage] = useState<"direct" | "proxy" | "fallback">(
    directUrl ? "direct" : "fallback"
  );

  useEffect(() => {
    const next = normalizeTokenImageUrl(src);
    setStage(next ? "direct" : "fallback");
  }, [src]);

  const theme = useMemo(() => getSymbolTheme(symbol), [symbol]);

  const handleError = () => {
    if (stage === "direct" && directUrl) {
      setStage("proxy");
    } else {
      setStage("fallback");
    }
  };

  const activeSrc =
    stage === "proxy"
      ? `/api/proxy/image?url=${encodeURIComponent(directUrl)}`
      : directUrl;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none rounded-[6px]">
      {(stage === "direct" || stage === "proxy") && activeSrc ? (
        <img
          src={activeSrc}
          alt=""
          onError={handleError}
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-20 transition-all duration-700"
        />
      ) : (
        <div
          className="absolute inset-0 opacity-10 transition-opacity duration-700"
          style={{
            background: `radial-gradient(circle at 85% 15%, var(--green) 0%, transparent 45%)`,
          }}
        />
      )}
      {/* Dark gradient overlay to ensure foreground content remains perfectly readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#111]/80 to-[#111]" />
    </div>
  );
}
