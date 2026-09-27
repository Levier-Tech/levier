'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useSmartPolling executes a periodic callback while the browser tab is actively visible.
 * When the user switches tabs or minimizes the window, polling is paused to conserve
 * bandwidth and server resources. When visibility returns, it executes immediately.
 */
export function useSmartPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true
) {
  const [isVisible, setIsVisible] = useState<boolean>(true);
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timerId: NodeJS.Timeout | null = null;

    const startTimer = () => {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (!document.hidden) {
          savedCallback.current();
        }
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsVisible(false);
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      } else {
        setIsVisible(true);
        // Fire immediately upon refocus/re-activation
        savedCallback.current();
        startTimer();
      }
    };

    // Initialize
    if (!document.hidden) {
      setIsVisible(true);
      startTimer();
    } else {
      setIsVisible(false);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timerId) clearInterval(timerId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs, enabled]);

  return { isVisible };
}
