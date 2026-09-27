"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletModal } from "./WalletModal";
import { MobileNavigation } from "./MobileNavigation";
import { useAccount } from "wagmi";

export function Header() {
  const pathname = usePathname();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const productsMenuRef = useRef<HTMLDetailsElement>(null);

  const formattedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : undefined;

  const isLanding = pathname === "/";

  const innerNavLinks = [
    { name: "Markets", href: "/markets" },
    { name: "China Equities", href: "/markets/china" },
    { name: "Pons", href: "/markets/pons" },
    { name: "Lending", href: "/lending" },
    { name: "Trade", href: "/trade" },
    { name: "Earn", href: "/earn" },
    { name: "Portfolio", href: "/portfolio" },
    { name: "Analytics", href: "/analytics" },
  ];

  // Close products dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        productsMenuRef.current &&
        !productsMenuRef.current.contains(event.target as Node)
      ) {
        productsMenuRef.current.removeAttribute("open");
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="header-container border-b border-[#1f201d] bg-[#080808] fixed w-full top-0 left-0 right-0 z-50">
        {/* LEFT NAVIGATION */}
        <nav className="nav-left" aria-label="Main navigation">
          {isLanding ? (
            <>
              <Link href="/markets" className="nav-link">
                Markets <span>↗</span>
              </Link>

              <Link href="/lending" className="nav-link">
                Lending <span>↗</span>
              </Link>

              <details className="products-menu" ref={productsMenuRef}>
                <summary className="flex items-center">
                  Products <span>+</span>
                </summary>
                <div className="dropdown">
                  <a
                    href="#products"
                    onClick={() => {
                      productsMenuRef.current?.removeAttribute("open");
                      window.dispatchEvent(
                        new CustomEvent("select-product-tab", {
                          detail: { tab: "borrow" },
                        }),
                      );
                    }}
                  >
                    Borrow
                  </a>
                  <a
                    href="#products"
                    onClick={() => {
                      productsMenuRef.current?.removeAttribute("open");
                      window.dispatchEvent(
                        new CustomEvent("select-product-tab", {
                          detail: { tab: "earn" },
                        }),
                      );
                    }}
                  >
                    Earn
                  </a>
                  <a
                    href="#products"
                    onClick={() => {
                      productsMenuRef.current?.removeAttribute("open");
                      window.dispatchEvent(
                        new CustomEvent("select-product-tab", {
                          detail: { tab: "leverage" },
                        }),
                      );
                    }}
                  >
                    Leverage
                  </a>
                </div>
              </details>

              <a className="nav-link faq-nav" href="#faq">
                FAQ
              </a>
            </>
          ) : (
            <div className="flex items-center gap-6">
              {innerNavLinks.map((link) => {
                const isActive =
                  pathname === link.href ||
                  pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`nav-link transition-colors ${
                      isActive
                        ? "text-[var(--green)] font-semibold"
                        : "text-muted hover:text-white"
                    }`}
                  >
                    {link.name}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        {/* CENTER WORDMARK */}
        <div className="flex items-center justify-center">
          <Link
            href="/"
            className="wordmark flex items-center gap-2.5"
            aria-label="Levier Markets home"
          >
            <img
              src="/assets/Logo.png"
              alt="Levier Emblem"
              className="w-7 h-7 object-contain rounded-sm shrink-0 drop-shadow-[0_0_8px_rgba(196,255,69,0.25)]"
            />
            <span className="flex items-baseline tracking-tight">
              LEVIER<span className="wordmark-dot"></span>
            </span>
          </Link>
        </div>

        {/* RIGHT NAVIGATION */}
        <div className="nav-right">
          <span className="chain-label">Robinhood Chain</span>

          {isLanding ? (
            <div className="flex items-center gap-3">
              <Link href="/markets" className="launch">
                Explore app <span aria-hidden="true">↗</span>
              </Link>
              <button
                onClick={() => setIsWalletModalOpen(true)}
                className="px-3 py-2 border border-[#303629] text-xs font-sans rounded text-[#c8cbc0] hover:border-[var(--green)] hover:text-white transition-colors"
              >
                {isConnected && formattedAddress ? formattedAddress : "Connect"}
              </button>
              <a
                href="https://x.com/LeveraMarke6"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow Levera on X (Twitter)"
                title="Follow Levera on X (@LeveraMarke6)"
                className="p-2 border border-[#303629] text-[#c8cbc0] hover:text-[var(--green)] hover:border-[var(--green)] rounded transition-colors flex items-center justify-center shrink-0"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-3 font-sans text-xs">
              <button
                onClick={() => setIsWalletModalOpen(true)}
                className="px-4 py-2 bg-[var(--green)] hover:bg-[#daff92] text-[#111] font-semibold tracking-wide rounded transition-all text-xs"
              >
                {isConnected && formattedAddress ? (
                  <span>{formattedAddress}</span>
                ) : (
                  "Connect wallet"
                )}
              </button>
              <a
                href="https://x.com/LeveraMarke6"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow Levera on X (Twitter)"
                title="Follow Levera on X (@LeveraMarke6)"
                className="p-2 border border-[#303629] text-[#c8cbc0] hover:text-[var(--green)] hover:border-[var(--green)] rounded transition-colors flex items-center justify-center shrink-0"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          )}
        </div>

        {/* MOBILE HAMBURGER BUTTON */}
        <button
          className="mobile-menu"
          aria-label="Open navigation"
          aria-expanded={isMobileNavOpen}
          aria-controls="mobile-nav"
          onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
        >
          Menu <span>{isMobileNavOpen ? "−" : "+"}</span>
        </button>
      </header>

      {/* MOBILE DRAWER */}
      <MobileNavigation
        isOpen={isMobileNavOpen}
        onClose={() => setIsMobileNavOpen(false)}
        onConnectWallet={() => setIsWalletModalOpen(true)}
        isConnected={isConnected}
        formattedAddress={formattedAddress}
      />

      {/* WALLET MODAL */}
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />
    </>
  );
}
