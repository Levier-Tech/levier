"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TokenLogo } from "./TokenLogo";

export interface GraduationToastItem {
  id: string;
  name: string;
  symbol: string;
  image?: string | null;
}

interface PonsGraduationToastProps {
  queue: GraduationToastItem[];
  onDismissAll: () => void;
}

/**
 * Stacked toast notification for newly graduated Pons tokens.
 * Positioned at the very top center of the viewport, below the fixed header.
 * Shows one toast at a time for 3 seconds, with stacked cards behind.
 */
export function PonsGraduationToast({ queue, onDismissAll }: PonsGraduationToastProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueLenRef = useRef(queue.length);
  const lastSoundTimeRef = useRef(0);

  const playNotificationSound = useCallback(() => {
    const now = Date.now();
    // Cooldown of 2 seconds to prevent rapid overlapping sounds
    if (now - lastSoundTimeRef.current < 2000) return;
    lastSoundTimeRef.current = now;

    try {
      // Ganti path ini dengan nama file MP3 Anda di folder public/assets
      const audio = new Audio("/assets/notification.mp3");
      audio.volume = 0.6; // Atur volume (0.0 sampai 1.0)
      audio.play().catch(() => {
        // Mengabaikan error jika browser memblokir suara karena user belum klik apa-apa (Autoplay Policy)
      });
    } catch (e) {
      console.error("Gagal memutar suara", e);
    }
  }, []);

  // Clear any pending timer
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Advance to next toast or dismiss all
  const dismissCurrent = useCallback(() => {
    clearTimer();
    setIsExiting(true);

    setTimeout(() => {
      setIsExiting(false);
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= queueLenRef.current) {
          // All toasts shown, dismiss everything
          onDismissAll();
          return 0;
        }
        return next;
      });
    }, 280);
  }, [clearTimer, onDismissAll]);

  // Keep queueLenRef in sync
  useEffect(() => {
    queueLenRef.current = queue.length;
  }, [queue.length]);

  // Reset when queue changes (new batch of toasts)
  useEffect(() => {
    clearTimer();
    setActiveIndex(0);
    setIsExiting(false);
  }, [queue, clearTimer]);

  // Play sound when active index changes (a new card is shown at the front)
  useEffect(() => {
    if (queue.length > 0 && activeIndex < queue.length) {
      playNotificationSound();
    }
  }, [activeIndex, queue.length, playNotificationSound]);

  // Auto-advance timer
  useEffect(() => {
    if (queue.length === 0) return;
    if (activeIndex >= queue.length) return;
    if (isExiting) return;

    timerRef.current = setTimeout(dismissCurrent, 3000);

    return clearTimer;
  }, [activeIndex, queue.length, isExiting, dismissCurrent, clearTimer]);

  // Don't render if nothing to show
  if (queue.length === 0 || activeIndex >= queue.length) return null;

  // Show up to 4 stacked cards
  const remaining = queue.length - activeIndex;
  const visibleCount = Math.min(remaining, 4);
  const visibleItems = queue.slice(activeIndex, activeIndex + visibleCount);

  return (
    <div
      style={{
        position: "fixed",
        top: "110px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        pointerEvents: "none",
        width: "400px",
        maxWidth: "92vw",
      }}
    >
      <div style={{ position: "relative", height: "80px" }}>
        {visibleItems.map((item, stackIdx) => {
          const isActive = stackIdx === 0;
          const offsetY = stackIdx * 8;
          const offsetX = stackIdx * 3;
          const scale = 1 - stackIdx * 0.035;
          const cardOpacity = isActive ? 1 : Math.max(0.35, 1 - stackIdx * 0.22);
          const cardZ = visibleCount - stackIdx;

          return (
            <div
              key={item.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${offsetY}px) translateX(${offsetX}px) scale(${
                  isActive && isExiting ? 0.92 : scale
                })`,
                opacity: isActive && isExiting ? 0 : cardOpacity,
                zIndex: cardZ,
                transition: "all 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                pointerEvents: isActive ? "auto" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "14px 16px",
                  background: "#111",
                  border: isActive ? "1px solid rgba(194, 255, 71, 0.5)" : "1px solid #292a27",
                  borderRadius: "8px",
                  boxShadow: isActive
                    ? "0 8px 32px rgba(194, 255, 71, 0.1), 0 4px 12px rgba(0,0,0,0.5)"
                    : "0 4px 16px rgba(0,0,0,0.3)",
                }}
              >
                {/* Token Logo */}
                <div style={{ flexShrink: 0 }}>
                  <TokenLogo src={item.image} symbol={item.symbol} size={38} showPonsBadge />
                </div>

                {/* Token Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: "14px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </span>
                    <span style={{ color: "#9b9b99", fontSize: "12px", fontWeight: 500, flexShrink: 0 }}>
                      ${item.symbol}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#c2ff47",
                        display: "inline-block",
                        flexShrink: 0,
                        boxShadow: "0 0 6px rgba(194, 255, 71, 0.6)",
                      }}
                    />
                    <span
                      style={{
                        color: "#c2ff47",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      Found New Graduated
                    </span>
                  </div>
                </div>

                {/* Close Button */}
                {isActive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissCurrent();
                    }}
                    style={{
                      flexShrink: 0,
                      width: "28px",
                      height: "28px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "4px",
                      border: "1px solid #292a27",
                      background: "#0c0d0c",
                      color: "#9b9b99",
                      cursor: "pointer",
                      padding: 0,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#c2ff47";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#292a27";
                      e.currentTarget.style.color = "#9b9b99";
                    }}
                    aria-label="Dismiss"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <path d="M2 2l8 8M10 2l-8 8" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stack counter */}
      {remaining > 1 && (
        <div style={{ textAlign: "center", marginTop: "6px", pointerEvents: "none" }}>
          <span
            style={{
              fontSize: "10px",
              color: "#9b9b99",
              fontWeight: 500,
              background: "#111",
              border: "1px solid #292a27",
              padding: "3px 10px",
              borderRadius: "12px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {activeIndex + 1} / {queue.length}
          </span>
        </div>
      )}
    </div>
  );
}
