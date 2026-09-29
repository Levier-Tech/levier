'use client';

import React from 'react';
import Link from 'next/link';

export function Footer() {
    const scrollToTop = (e: React.MouseEvent) => {
        e.preventDefault();
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    return (
        <footer className="footer-wrap section-wrap border-t border-[var(--line)] bg-[var(--bg)]">
            <div className="footer-top">
                <div className="footer-brand">
                    <Link
                        href="/"
                        className="wordmark flex items-center gap-2.5"
                        aria-label="Levier Markets home"
                    >
                        <img
                            src="/assets/levier-logo-new-trimmed.png"
                            alt="Levier Emblem"
                            className="h-11 w-auto shrink-0 drop-shadow-[0_0_8px_rgba(196,255,69,0.25)]"
                        />
                        <span className="flex items-baseline tracking-tight">
                            LEVIER
                        </span>
                    </Link>
                    <p>
                        The credit and leverage layer for tokenized assets
                        <br />
                        on Robinhood Chain.
                    </p>
                    <a href="#main" onClick={scrollToTop} className="back-top">
                        Back to top ↑
                    </a>
                </div>

                <div className="footer-links">
                    <div className="footer-links-group">
                        <span className="footer-links-label">Product</span>
                        <nav className="footer-links-list" aria-label="Product">
                            <Link
                                href="/markets"
                                className="hover:text-[var(--green)] transition-colors"
                            >
                                Markets
                            </Link>
                            <Link
                                href="/trade"
                                className="hover:text-[var(--green)] transition-colors"
                            >
                                Trade
                            </Link>
                            <Link
                                href="/earn"
                                className="hover:text-[var(--green)] transition-colors"
                            >
                                Earn
                            </Link>
                            <Link
                                href="/portfolio"
                                className="hover:text-[var(--green)] transition-colors"
                            >
                                Portfolio
                            </Link>
                            <Link
                                href="/analytics"
                                className="hover:text-[var(--green)] transition-colors"
                            >
                                Analytics
                            </Link>
                        </nav>
                    </div>

                    <div className="footer-links-group">
                        <span className="footer-links-label">Follow</span>
                        <a
                            href="https://x.com/LeveraMarke6"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Follow Levera on X (Twitter)"
                            title="Follow Levera on X (@LeveraMarke6)"
                            className="p-2 rounded border border-[var(--line)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--green)] hover:border-[var(--green)] transition-all flex items-center justify-center shrink-0 w-fit"
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
                </div>
            </div>

            <div className="footer-bottom">
                <span>© 2026 Levier Markets</span>
                <a
                    href="https://x.com/LeveraMarke6"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Follow Levera on X (Twitter)"
                    title="Follow Levera on X (@LeveraMarke6)"
                    className="inline-flex items-center text-[var(--muted)] hover:text-[var(--green)] transition-colors"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-3.5 h-3.5"
                        aria-hidden="true"
                    >
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                </a>
                <span className="text-[var(--green)]">
                    ROBINHOOD CHAIN PROTOCOL
                </span>
                <span>Credit. Exposure. Possibility.</span>
            </div>
        </footer>
    );
}
