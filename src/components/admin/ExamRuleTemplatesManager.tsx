"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminGate, inputClass, labelClass } from "@/components/admin/admin-ui";
import { AccessLoading } from "@/components/auth/AccessGuard";
import type { RuleTemplateKey } from "@/lib/exam-rule-templates";
import {
  BD_PHONE_MESSAGE,
  EMAIL_MESSAGE,
  URL_MESSAGE,
  TXN_ID_MESSAGE,
} from "@/lib/form-validation";

type Rule = { id: number | null; title: string; text: string };

const TABS: Array<{ key: RuleTemplateKey; label: string; hint: string }> = [
  { key: "academic", label: "Academic", hint: "No negative marking, no second-timer." },
  { key: "medical", label: "Medical", hint: "Negative marking + second-timer penalty." },
  { key: "university", label: "Varsity", hint: "Negative marking, no second-timer." },
];

/**
 * Whole-website accepted input formats (single source of truth lives in
 * `@/lib/form-validation` — the same validators every form enforces).
 * Shown here so admins know exactly what passes validation on any page.
 */
const INPUT_FORMATS: Array<{
  field: string;
  format: string;
  accepted: string[];
  rejected: string[];
  message: string;
}> = [
  {
    field: "Mobile Number",
    format: "+8801XXXXXXXXX (operator digit 3–9)",
    accepted: ["01712345678", "8801712345678", "+8801712345678", "০১৭১২৩৪৫৬৭৮"],
    rejected: ["01212345678", "0171234567", "02234567890"],
    message: BD_PHONE_MESSAGE,
  },
  {
    field: "Email",
    format: "name@example.com",
    accepted: ["student@gmail.com", "a@b.co"],
    rejected: ["bad@", "no-at.com"],
    message: EMAIL_MESSAGE,
  },
  {
    field: "Link / URL",
    format: "https://… or site path /contact",
    accepted: ["https://facebook.com/xyz", "/contact", "facebook.com/xyz"],
    rejected: ["nota url!!", "javascript:alert(1)"],
    message: URL_MESSAGE,
  },
  {
    field: "Transaction ID (bKash/Nagad)",
    format: "4–64 chars, letters/digits/-/_",
    accepted: ["8N7DQK2XLM", "TXN-1234_AB"],
    rejected: ["ab", "has space"],
    message: TXN_ID_MESSAGE,
  },
  {
    field: "Coupon Code",
    format: "2–32 chars, UPPERCASE letters/digits/-/_",
    accepted: ["HSC28", "MEDI-50"],
    rejected: ["x", "has space"],
    message: "Coupon auto-uppercases (hsc28 → HSC28).",
  },
  {
    field: "Full Name",
    format: "2–100 chars, Bangla/English letters only",
    accepted: ["রহিম উদ্দিন", "Siam Ahmed"],
    rejected: ["A", "Name123"],
    message: "Letters (EN/BN), spaces, dots, apostrophes, dashes.",
  },
  {
    field: "Date & Time",
    format: "YYYY-MM-DDTHH:mm",
    accepted: ["2026-09-28T10:30"],
    rejected: ["28-09-2026", "2026-13-99T99:99"],
    message: "Use the calendar picker — manual text must match the format.",
  },
];

/**
 * Admin → Exam Rules — central rule contents for the 3 exam types.
 * Exam create only SELECTS Academic/Medical/Varsity; the texts live here.
 */
export default function ExamRuleTemplatesManager() {
  const gate = useAdminGate();
  const [tab, setTab] = useState<RuleTemplateKey>("academic");
  const [lang, setLang] = useState<"bangla" | "english">("bangla");
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!gate.ready) return;
    setLoadError(false);
    setRules(null);
    setShowAdd(false);
    setEditingRule(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/exam-rule-templates?template=${tab}&lang=${lang}`, {
        cache: "no-store",
        headers: gate.headers,
      });
      const data = (await res.json()) as { rules?: Rule[] };
      if (!res.ok) throw new Error("load");
      setRules(data.rules ?? []);
    } catch {
      setLoadError(true);
    }
  }, [gate.ready, gate.headers, tab, lang]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function startAdd() {
    setEditingRule(null);
    setDraftTitle("");
    setDraftText("");
    setShowAdd(true);
    setError(null);
  }

  function startEdit(rule: Rule) {
    setEditingRule(rule);
    setDraftTitle(rule.title);
    setDraftText(rule.text);
    setShowAdd(true);
    setError(null);
  }

  async function saveRule() {
    if (!draftText.trim()) {
      setError("Rule text is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/exam-rule-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({ template: tab, lang, id: editingRule?.id ?? undefined, title: draftTitle.trim(), text: draftText.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; rules?: Rule[] } | null;
      if (!res.ok || !data) {
        setError(data?.error ?? "Failed to save the rule.");
        return;
      }
      setRules(data.rules ?? []);
      setShowAdd(false);
      setEditingRule(null);
      setDraftTitle("");
      setDraftText("");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: number) {
    if (!window.confirm("Delete this rule?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exam-rule-templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({ template: tab, lang, id }),
      });
      const data = (await res.json().catch(() => null)) as { rules?: Rule[] } | null;
      if (res.ok && data?.rules) setRules(data.rules);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!rules) return;
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    const ids = next.map((r) => r.id).filter((id): id is number => id !== null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/exam-rule-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({ template: tab, lang, order: ids }),
      });
      const data = (await res.json().catch(() => null)) as { rules?: Rule[] } | null;
      if (res.ok && data?.rules) setRules(data.rules);
    } finally {
      setBusy(false);
    }
  }

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
        </div>
      </section>
    );
  }

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <section className="mx-auto max-w-4xl px-3 py-6 sm:px-6 sm:py-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-[#234e9f] admin-dark:text-[#93c5fd]">Admin · Exams</p>
        <h1 className="mt-1 text-2xl font-extrabold text-[#0b1e3a] sm:text-3xl admin-dark:text-white">Exam Rules</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 admin-dark:text-[#8da0c0]">
          ৩ ধরনের পরীক্ষার নিয়ম এখান থেকে বদলান। Exam create-এর সময় শুধু type সিলেক্ট করা হয় — লেখা আসে এখান থেকে।
        </p>
      </header>

      <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-neutral-200 p-1.5 admin-dark:border-zinc-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-3 py-2.5 text-sm font-extrabold transition ${
              tab === t.key
                ? "bg-primary-600 text-white shadow"
                : "text-slate-500 hover:bg-slate-100 admin-dark:text-slate-300 admin-dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{active.label}: {active.hint}</p>

      <div className="mt-3 flex gap-2">
        {(["bangla", "english"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-extrabold transition ${
              lang === l
                ? "border-primary-600 bg-primary-600 text-white shadow"
                : "border-neutral-200 text-slate-500 hover:bg-slate-100 admin-dark:border-zinc-700 admin-dark:text-slate-300 admin-dark:hover:bg-zinc-800"
            }`}
          >
            {l === "bangla" ? "বাংলা" : "English"}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        {lang === "bangla" ? "Bangla Version-এর student-রা এই নিয়মগুলো দেখবে।" : "English Version-এর student-রা এই নিয়মগুলো দেখবে।"}
      </p>

      <div className="mt-4 rounded-2xl border border-neutral-200 p-4 admin-dark:border-zinc-700">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#0b1e3a] admin-dark:text-zinc-100">
            {active.label} Rules ({lang === "bangla" ? "বাংলা" : "English"})
          </h4>
          {!showAdd && (
            <button
              type="button"
              onClick={startAdd}
              className="shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-bold text-primary-600 transition hover:border-primary-500 admin-dark:border-zinc-700"
            >
              + Add Rule
            </button>
          )}
        </div>

        {rules === null && !loadError && <p className="mt-4 text-xs text-slate-500">Loading rules…</p>}
        {loadError && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-red-500">Something went wrong.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-bold admin-dark:border-zinc-700"
            >
              Try Again
            </button>
          </div>
        )}
        {rules !== null && !loadError && rules.length === 0 && !showAdd && (
          <p className="mt-4 rounded-xl border border-dashed border-neutral-200 p-4 text-center text-xs text-slate-500 admin-dark:border-zinc-700">
            No rules yet — add the first one.
          </p>
        )}
        {rules !== null && rules.length > 0 && (
          <ul className="mt-4 space-y-2">
            {rules.map((rule, index) => (
              <li key={rule.id ?? index} className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 p-3 admin-dark:border-zinc-700">
                <div className="min-w-0 flex-1">
                  {rule.title && <p className="text-xs font-bold text-[#0b1e3a] admin-dark:text-zinc-100">{index + 1}. {rule.title}</p>}
                  <p className="text-xs leading-relaxed text-slate-500 admin-dark:text-slate-400">
                    {rule.title ? "" : `${index + 1}. `}{rule.text}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="flex flex-col gap-0.5">
                    <button type="button" disabled={busy || index === 0} aria-label={`Move rule ${index + 1} up`} onClick={() => void move(index, -1)} className="rounded border border-neutral-200 px-1.5 text-[10px] text-slate-500 disabled:opacity-30 admin-dark:border-zinc-700">↑</button>
                    <button type="button" disabled={busy || index === rules.length - 1} aria-label={`Move rule ${index + 1} down`} onClick={() => void move(index, 1)} className="rounded border border-neutral-200 px-1.5 text-[10px] text-slate-500 disabled:opacity-30 admin-dark:border-zinc-700">↓</button>
                  </span>
                  <button type="button" disabled={busy} onClick={() => startEdit(rule)} className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-bold text-zinc-600 disabled:opacity-40 admin-dark:border-zinc-700 admin-dark:text-zinc-300">Edit</button>
                  <button type="button" disabled={busy} aria-label="Delete rule" onClick={() => rule.id !== null && void removeRule(rule.id)} className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-bold text-red-500 disabled:opacity-40 admin-dark:border-red-900">✕</button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {showAdd && (
          <div className="mt-4 space-y-3 rounded-xl border border-primary-500/40 bg-primary-500/5 p-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary-600">{editingRule ? "Edit Rule" : "New Rule"}</p>
            <div>
              <label className={`${labelClass} mb-1 block`} htmlFor={`tpl-rule-title-${tab}`}>Title (optional)</label>
              <input id={`tpl-rule-title-${tab}`} className={inputClass} value={draftTitle} placeholder="e.g. Negative Marking" onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div>
              <label className={`${labelClass} mb-1 block`} htmlFor={`tpl-rule-text-${tab}`}>Rule Text</label>
              <textarea id={`tpl-rule-text-${tab}`} className={`${inputClass} min-h-[70px]`} value={draftText} placeholder="Each wrong answer deducts 0.25 marks…" onChange={(e) => setDraftText(e.target.value)} />
            </div>
            {error && <p className="text-xs font-semibold text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void saveRule()} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Saving…" : editingRule ? "Update Rule" : "Add Rule"}
              </button>
              <button type="button" onClick={() => { setShowAdd(false); setEditingRule(null); setError(null); }} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-bold text-zinc-600 admin-dark:border-zinc-700 admin-dark:text-zinc-300">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Whole-website supported input formats — what passes validation on any page */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4 admin-dark:border-zinc-700">
        <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#0b1e3a] admin-dark:text-zinc-100">
          Supported Input Formats
        </h4>
        <p className="mt-0.5 text-xs text-slate-500">
          সারা ওয়েবসাইটে এই format-গুলো লিখলে input validate হবে — ভুল format-এ error দেখাবে।
        </p>
        <ul className="mt-3 space-y-2">
          {INPUT_FORMATS.map((f) => (
            <li key={f.field} className="rounded-xl border border-neutral-200 p-3 admin-dark:border-zinc-700">
              <p className="text-xs font-extrabold text-[#0b1e3a] admin-dark:text-zinc-100">
                {f.field} <span className="ml-1 font-mono font-bold text-primary-600">{f.format}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-600 admin-dark:text-emerald-400">
                ✓ {f.accepted.join(" · ")}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-red-500">
                ✕ {f.rejected.join(" · ")}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{f.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
