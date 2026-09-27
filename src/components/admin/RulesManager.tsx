"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminGate, cardClass, inputClass, labelClass, buttonSecondaryClass } from "@/components/admin/admin-ui";
import { AccessLoading } from "@/components/auth/AccessGuard";
import { useAuth } from "@/lib/auth-context";

type DocItem = {
  id: string;
  title: string;
  text: string;
  source: string;
};

type DocSection = {
  id: string;
  category: string;
  title: string;
  intro: string;
  items: DocItem[];
};

/**
 * Read-only internal reference viewer: "how the whole website functions".
 * No add/edit/archive — content is the verified doc served by the gated
 * GET /api/admin/rules endpoint. Nothing is bundled client-side.
 */
export default function RulesManager({ standalone = false }: { standalone?: boolean }) {
  const gate = useAdminGate();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const [sections, setSections] = useState<DocSection[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [updated, setUpdated] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");

  // Standalone /rules.html gate: unauthenticated → /login, non-admin → /.
  useEffect(() => {
    if (!standalone || authLoading) return;
    if (!user) {
      router.replace("/login?next=%2Frules.html");
      return;
    }
    if (gate.denied) router.replace("/");
  }, [standalone, authLoading, user, gate.denied, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchDoc = useCallback(async () => {
    if (!gate.ready) return;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (debouncedQ) sp.set("q", debouncedQ);
      if (category) sp.set("category", category);
      const res = await fetch(`/api/admin/rules?${sp.toString()}`, { headers: gate.headers, cache: "no-store" });
      const data = (await res.json().catch(() => null)) as {
        sections?: DocSection[];
        categories?: string[];
        updated?: string;
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? "লোড হয়নি।");
      setSections(Array.isArray(data?.sections) ? data.sections : []);
      if (Array.isArray(data?.categories) && data.categories.length > 0) setCategories(data.categories);
      setUpdated(data?.updated ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড হয়নি।");
    } finally {
      setLoading(false);
    }
  }, [gate.ready, gate.headers, debouncedQ, category]);

  useEffect(() => {
    void fetchDoc();
  }, [fetchDoc]);

  const totalItems = useMemo(() => sections.reduce((n, s) => n + s.items.length, 0), [sections]);

  if (!gate.ready) {
    return (
      <section className="mx-auto max-w-4xl px-3 py-10 sm:px-6">
        <AccessLoading label="অ্যাডমিন চেক হচ্ছে…" />
      </section>
    );
  }

  if (gate.denied) {
    return (
      <section className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8">
          <p className="text-lg font-extrabold text-red-600">অ্যাডমিন লগইন লাগবে</p>
          <p className="mt-2 text-sm text-neutral-600 admin-dark:text-slate-400">
            ভেতরের নিয়ম দেখতে অনুমোদিত MediSpark BD অ্যাডমিন অ্যাকাউন্ট দিয়ে লগইন করুন।
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-[#234e9f] admin-dark:text-[#93c5fd]">শুধু অ্যাডমিনদের জন্য</p>
        <h1 className="mt-1 text-2xl font-extrabold text-[#0b1e3a] sm:text-3xl admin-dark:text-white">
          MediSpark BD কীভাবে চলে
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 admin-dark:text-[#8da0c0]">
          ওয়েবসাইটের সব নিয়ম এক জায়গায় — লগইন, কোর্স,
          পরীক্ষা, পেমেন্ট, প্রশ্নোত্তর, মিডিয়া, ডাটাবেজ আর সার্ভার। প্রতিটার সাথে সোর্স ফাইল
          লেখা আছে।{updated ? ` সর্বশেষ চেক ${updated}।` : ""}
        </p>
      </header>

      <div className={`${cardClass} mt-5 p-4`}>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div>
            <label className={labelClass} htmlFor="rules-q">নিয়ম খুঁজুন</label>
            <input
              id="rules-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="যেমন: নেগেটিভ মার্কিং, কুপন, ভর্তি…"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="rules-cat">বিভাগ</label>
            <select id="rules-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">সব বিভাগ ({totalItems}টি নিয়ম)</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className={`${cardClass} mt-4 p-6`}><AccessLoading label="লোড হচ্ছে…" /></div>
      ) : error ? (
        <div className={`${cardClass} mt-4 p-6 text-center`}>
          <p className="text-sm font-bold text-red-600">{error}</p>
          <button type="button" onClick={() => void fetchDoc()} className={`${buttonSecondaryClass} mt-3`}>আবার চেষ্টা করুন</button>
        </div>
      ) : sections.length === 0 ? (
        <div className={`${cardClass} mt-4 p-10 text-center`}>
          <p className="text-base font-extrabold text-[#0b1e3a] admin-dark:text-white">কিছু পাওয়া যায়নি</p>
          <p className="mt-1 text-sm text-slate-500">অন্য শব্দ বা বিভাগ দিয়ে খুঁজে দেখুন।</p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {sections.map((s) => (
            <article key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="text-lg font-extrabold text-[#0b1e3a] admin-dark:text-white">{s.title}</h2>
              <p className="mt-0.5 text-sm text-slate-500 admin-dark:text-[#8da0c0]">{s.intro}</p>
              <div className="mt-3 space-y-3">
                {s.items.map((item) => (
                  <div key={item.id} className={`${cardClass} p-4`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] font-bold text-[#234e9f] admin-dark:text-[#93c5fd]">{item.id}</span>
                      <h3 className="text-sm font-extrabold text-[#0b1e3a] admin-dark:text-slate-100">{item.title}</h3>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600 admin-dark:text-slate-300">{item.text}</p>
                    <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-400 admin-dark:text-[#8da0c0]">
                      সোর্স: {item.source}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
