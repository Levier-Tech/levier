"use client";

import React from "react";

interface ChinaAssetLogoProps {
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-5 h-5 text-[9px]",
  md: "w-6 h-6 text-[10px]",
  lg: "w-8 h-8 text-xs",
};

export function ChinaAssetLogo({ symbol, size = "md", className = "" }: ChinaAssetLogoProps) {
  const cleanSymbol = symbol ? symbol.toUpperCase().slice(0, 4) : "CN";
  return (
    <div
      className={`rounded bg-[#181a17] border border-[#292a27] flex items-center justify-center font-display font-bold text-[#c2ff47] shrink-0 ${sizeClasses[size]} ${className}`}
    >
      {cleanSymbol.slice(0, 3)}
    </div>
  );
}
