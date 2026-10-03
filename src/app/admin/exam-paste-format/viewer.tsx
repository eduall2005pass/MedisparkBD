"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Admin-only Exam Paste Format guide.
 * The guide HTML is inlined via `srcDoc` so it never lives under `public/`
 * (no public URL). The frame needs `allow-same-origin` — without it the
 * iframe gets an opaque origin and both `navigator.clipboard.writeText`
 * and the `execCommand("copy")` fallback silently fail, so the Copy buttons
 * do nothing. The content is our own static guide (no user input), so
 * same-origin is safe; `allow-top-navigation` is still NOT granted, so the
 * frame cannot redirect the admin panel.
 */
export default function PasteFormatViewer({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await frameRef.current?.requestFullscreen();
      }
    } catch {
      // Fullscreen unavailable (e.g. iframe permissions) — page still works inline.
    }
  };

  return (
    <section className="px-2 py-3 sm:px-4">
      <header className="flex flex-wrap items-center gap-2 px-1">
        <h1 className="min-w-0 flex-1 truncate text-base font-extrabold text-[#0b1e3a] sm:text-lg admin-dark:text-white">
          📝 Exam Paste Format
          <span className="ml-2 hidden text-xs font-semibold text-slate-400 sm:inline admin-dark:text-[#8da0c0]">
            admin-only
          </span>
        </h1>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="shrink-0 rounded-xl bg-[#1a3a78] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#234e9f]"
        >
          {isFull ? "⤓ Exit Full" : "⛶ Full Page"}
        </button>
        <Link
          href="/admin/public-exam-control"
          className="shrink-0 rounded-xl border border-[#dbeafe] bg-white px-4 py-2 text-sm font-bold text-[#1a3a78] transition hover:border-[#93c5fd] hover:bg-[#f8fbff] admin-dark:border-[#1e3a65] admin-dark:bg-[#112544] admin-dark:text-[#93c5fd] admin-dark:hover:bg-[#132a4f]"
        >
          ← Exam Control
        </Link>
      </header>

      <iframe
        ref={frameRef}
        title="Exam Paste Format Guide"
        srcDoc={html}
        sandbox="allow-scripts allow-same-origin allow-modals"
        allow="clipboard-write"
        className="mt-2 h-[calc(100vh-140px)] min-h-[600px] w-full rounded-xl border border-[#dbeafe] bg-white admin-dark:border-[#1e3a65]"
      />
    </section>
  );
}
