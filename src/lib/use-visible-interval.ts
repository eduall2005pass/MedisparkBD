"use client";

import { useEffect } from "react";

/**
 * setInterval that fires ONLY while the tab is visible.
 * Background tabs cost zero function invocations — with 100 students
 * keeping tabs open, this is the single biggest usage saver.
 * `cb` must be stable (useCallback).
 */
export function useVisibleInterval(cb: () => void, ms: number) {
  useEffect(() => {
    if (ms <= 0) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      cb();
    }, ms);
    return () => window.clearInterval(id);
  }, [cb, ms]);
}
