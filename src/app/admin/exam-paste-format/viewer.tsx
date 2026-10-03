"use client";

import Link from "next/link";

/**
 * Admin-only Exam Paste Format guide.
 * The guide HTML is inlined via `srcDoc` so it never lives under `public/`
 * (no public URL). Scripts run inside a sandboxed iframe — formatter,
 * palette and copy buttons keep working, but the frame cannot touch the
 * parent admin session (no `allow-same-origin`).
 */
export default function PasteFormatViewer({ html }: { html: string }) {
  return (
    <section className="mx-auto max-w-6xl px-3 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-[#234e9f] admin-dark:text-[#93c5fd]">
            Exams
          </p>
          <h1 className="mt-1 text-xl font-extrabold text-[#0b1e3a] sm:text-2xl admin-dark:text-white">
            📝 Exam Paste Format
          </h1>
          <p className="mt-1 text-sm text-slate-500 admin-dark:text-[#8da0c0]">
            Admin-only guide — how to paste questions so Detect works. Not
            visible on the public site.
          </p>
        </div>
        <Link
          href="/admin/public-exam-control"
          className="shrink-0 rounded-xl border border-[#dbeafe] bg-white px-4 py-2.5 text-sm font-bold text-[#1a3a78] transition hover:border-[#93c5fd] hover:bg-[#f8fbff] admin-dark:border-[#1e3a65] admin-dark:bg-[#112544] admin-dark:text-[#93c5fd] admin-dark:hover:bg-[#132a4f]"
        >
          ← Back to Public Exam Control
        </Link>
      </header>

      <iframe
        title="Exam Paste Format Guide"
        srcDoc={html}
        sandbox="allow-scripts allow-modals"
        className="mt-4 h-[calc(100vh-240px)] min-h-[600px] w-full rounded-2xl border border-[#dbeafe] bg-white shadow-sm shadow-[#0b1e3a]/5 admin-dark:border-[#1e3a65]"
      />
    </section>
  );
}
