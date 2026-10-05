"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import type { EnrolledExamCardSettings } from "@/lib/enrolled-exam-card";
import EnrolledExamCardIcon from "@/components/EnrolledExamCardIcon";

export default function EnrolledExamShortcut() {
  const [settings, setSettings] = useState<EnrolledExamCardSettings | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/public-exams/enrolled-card", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { settings: EnrolledExamCardSettings };
      setSettings(data.settings);
    } catch {
      // Keep the last confirmed setting; never flash a default-enabled card.
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onVisible);
    window.addEventListener("enrolled-exam-card-updated", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const onStorage = (event: StorageEvent) => { if (event.key === "enrolled-exam-card-updated") onVisible(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("enrolled-exam-card-updated", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);
  useVisibleInterval(load, 60_000);

  if (!settings?.is_active) return null;
  return (
    <Link href="/exam/enrolled" className="group relative mb-6 flex items-center gap-4 overflow-hidden rounded-2xl border border-ink/10 bg-dark-900 p-6 shadow-lg shadow-black/20 transition duration-150 hover:-translate-y-1 hover:border-primary-600/60 hover:shadow-primary-900/30 active:scale-[0.99]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary-600/10 blur-3xl" />
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-600/15 text-primary-500 transition group-hover:bg-primary-600 group-hover:text-white">
        <EnrolledExamCardIcon icon={settings.icon} />
      </span>
      <div className="relative min-w-0 flex-1">
        <h3 className="text-lg font-extrabold leading-snug text-heading group-hover:text-primary-400 sm:text-xl">{settings.title}</h3>
        {settings.subtitle && <p className="mt-1 text-sm text-neutral-400">{settings.subtitle}</p>}
      </div>
      <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-primary-400 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7" /></svg>
    </Link>
  );
}
