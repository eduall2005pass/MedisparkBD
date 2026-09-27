"use client";

import { useEffect } from "react";

/** Registers the root PWA + push worker once (safe to call alongside FCM). */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // updateViaCache:none → browser re-checks /sw.js on every load, so
    // icon/manifest updates reach devices instead of sticking for days.
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => undefined);
  }, []);
  return null;
}
