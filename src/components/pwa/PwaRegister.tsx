"use client";

import { useEffect } from "react";

/** Registers the root PWA + push worker once (safe to call alongside FCM). */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Skip re-registering when FCM already owns an equivalent registration.
    void navigator.serviceWorker
      .register("/sw.js")
      .catch(() => undefined);
  }, []);
  return null;
}
