"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface MobileNavigationProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectWallet?: () => void;
  isConnected?: boolean;
  formattedAddress?: string;
}

export function MobileNavigation({
  isOpen,
  onClose,
  onConnectWallet,
  isConnected,
  formattedAddress,
}: MobileNavigationProps) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (!isOpen) return null;

  const innerNavLinks = [
    { name: "Markets", href: "/markets" },
    { name: "China Equities", href: "/markets/china" },
    { name: "Pons (Graduated)", href: "/markets/pons" },
    { name: "Lending", href: "/lending" },
    { name: "Trade (Leverage)", href: "/trade" },
    { name: "Earn (Vaults)", href: "/earn" },
    { name: "Portfolio", href: "/portfolio" },
    { name: "Analytics", href: "/analytics" },
  ];

  return (
    <nav
      id="mobile-nav"
      className="mobile-nav flex flex-col absolute top-[79px] left-0 right-0 max-h-[calc(100vh-80px)] overflow-y-auto bg-[#12160e] border-b border-[#39432e] px-[6%] py-4 z-50 animate-appear shadow-2xl"
      aria-label="Mobile navigation"
    >
      {isLanding ? (
        <>
          <Link
            href="/markets"
            onClick={onClose}
            className="py-3 text-left border-b border-[#29311f] text-[#cececa] hover:text-[var(--green)]"
          >
            Markets ↗
          </Link>
          <Link
            href="/lending"
            onClick={onClose}
            className="py-3 text-left border-b border-[#29311f] text-[#cececa] hover:text-[var(--green)]"
          >
            Lending ↗
          </Link>
          <a
            href="#products"
            onClick={onClose}
            className="py-3 text-left border-b border-[#29311f] text-[#cececa] hover:text-[var(--green)]"
          >
            Products
          </a>
          <a
            href="#faq"
            onClick={onClose}
            className="py-3 text-left border-b border-[#29311f] text-[#cececa] hover:text-[var(--green)]"
          >
            FAQ
          </a>
          <Link
            href="/markets"
            onClick={onClose}
            className="py-3 text-left border-b border-[#29311f] text-[var(--green)] font-medium flex items-center justify-between"
          >
            <span>Launch App</span>
            <span>↗</span>
          </Link>
        </>
      ) : (
        <>
          {innerNavLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                onClick={onClose}
                className={`py-3 text-left border-b border-[#29311f] text-sm ${
                  isActive
                    ? "text-[var(--green)] font-semibold"
                    : "text-[#cececa] hover:text-white"
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </>
      )}

      {/* Social / X Link */}
      <div className="py-3 border-b border-[#29311f] flex items-center">
        <a
          href="https://x.com/LeveraMarke6"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          aria-label="Follow Levera on X (Twitter)"
          title="Follow Levera on X (@LeveraMarke6)"
          className="p-2 border border-[#303629] text-[#c8cbc0] hover:text-[var(--green)] hover:border-[var(--green)] rounded transition-colors flex items-center justify-center"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </div>

      {onConnectWallet && (
        <div className="pt-4 pb-2">
          <button
            onClick={() => {
              onClose();
              onConnectWallet();
            }}
            className="w-full py-3 bg-[var(--green)] text-[#111] font-semibold text-center rounded text-sm hover:bg-[#daff92] transition-colors"
          >
            {isConnected && formattedAddress
              ? formattedAddress
              : "Connect Wallet"}
          </button>
        </div>
      )}
    </nav>
  );
}
