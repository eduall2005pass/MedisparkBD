"use client";

import { useEffect } from "react";

/** Registers the root PWA + push worker once (safe to call alongside FCM). */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let interval: number | undefined;
    const update = () => {
      // No-arg: registration controlling this document (root scope "/").
      void navigator.serviceWorker
        .getRegistration()
        .then((reg) => reg?.update().catch(() => undefined))
        .catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };
    // updateViaCache:none → browser re-checks /sw.js on every load, so
    // icon/manifest updates reach devices instead of sticking for days.
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then(() => {
        if (cancelled) return;
        // Slow-network users can keep a days-old worker that serves stale
        // app shells — poll for updates when the tab regains focus and
        // hourly while open. The new worker activates via skipWaiting +
        // claim without reloading (never interrupt an ongoing exam).
        window.addEventListener("focus", update);
        document.addEventListener("visibilitychange", onVisibility);
        interval = window.setInterval(update, 60 * 60 * 1000);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
