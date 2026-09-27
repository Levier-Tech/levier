"use client";
import { useState } from "react";
import { assetCatalog } from "../lib/asset-catalog";
export function AssetLogo({
  symbol,
  size = "md",
  className = "",
}: {
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const asset = assetCatalog.find(
    (entry) => entry.ticker === symbol.toUpperCase(),
  );
  return (
    <span
      className={`asset-logo asset-logo-${size} ${className}`}
      title={symbol}
    >
      {asset && failedImage !== asset.image ? (
        <img
          src={asset.image}
          alt={symbol}
          onError={() => setFailedImage(asset.image)}
        />
      ) : (
        symbol.slice(0, 4)
      )}
    </span>
  );
}
