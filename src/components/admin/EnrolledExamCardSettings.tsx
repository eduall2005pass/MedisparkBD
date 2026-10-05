"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ENROLLED_EXAM_CARD_ICONS,
  validateEnrolledExamCard,
  type EnrolledExamCardSettings,
} from "@/lib/enrolled-exam-card";
import EnrolledExamCardIcon from "@/components/EnrolledExamCardIcon";
import { buttonPrimaryClass, cardClass, inputClass, labelClass, noticeClass, type Notice } from "@/components/admin/admin-ui";

type SettingsResponse = { settings?: EnrolledExamCardSettings; error?: string };

export default function EnrolledExamCardSettingsEditor({ headers }: { headers: Record<string, string> }) {
  const [settings, setSettings] = useState<EnrolledExamCardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const response = await fetch("/api/admin/exams/enrolled-card", { headers, cache: "no-store" });
      const data = await response.json() as SettingsResponse;
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Could not load card settings.");
      setSettings(data.settings);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load card settings." });
    }
  }, [headers]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  async function save(reset = false) {
    if (!settings || busy) return;
    if (reset && !window.confirm("Reset the card to its default title, icon and visible state?")) return;
    setNotice(null);
    try {
      const next = reset ? null : validateEnrolledExamCard(settings);
      setBusy(true);
      const response = await fetch("/api/admin/exams/enrolled-card", {
        method: reset ? "DELETE" : "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        ...(next ? { body: JSON.stringify(next) } : {}),
      });
      const data = await response.json() as SettingsResponse;
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Could not save card settings.");
      setSettings(data.settings);
      setNotice({ kind: "success", text: reset ? "Default card settings restored." : "Enrolled exam card settings saved." });
      window.dispatchEvent(new Event("enrolled-exam-card-updated"));
      try { window.localStorage.setItem("enrolled-exam-card-updated", String(Date.now())); } catch { /* Polling still refreshes other tabs. */ }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save card settings." });
    } finally {
      setBusy(false);
    }
  }

  function update(patch: Partial<EnrolledExamCardSettings>) {
    setSettings((previous) => previous ? { ...previous, ...patch } : previous);
  }

  return (
    <section className={`${cardClass} mt-6 space-y-5 p-5`}>
      <header>
        <h3 className="text-lg font-extrabold text-[#0b1e3a] admin-dark:text-white">My Enrolled Exams Shortcut</h3>
        <p className="mt-1 text-sm text-slate-500 admin-dark:text-slate-400">Manage the shortcut above Explore Public Exams. Course banners, names and exam routes come from the current course catalog.</p>
      </header>
      {settings ? <>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
          <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={settings.is_active} onChange={(event) => update({ is_active: event.target.checked })} />
          Show shortcut on the public website
        </label>
        <div>
          <label htmlFor="enrolled-card-title" className={labelClass}>Card Title</label>
          <input id="enrolled-card-title" className={inputClass} maxLength={120} value={settings.title} onChange={(event) => update({ title: event.target.value })} />
        </div>
        <div>
          <label htmlFor="enrolled-card-subtitle" className={labelClass}>Subtitle</label>
          <textarea id="enrolled-card-subtitle" className={inputClass} rows={2} maxLength={500} value={settings.subtitle} onChange={(event) => update({ subtitle: event.target.value })} />
        </div>
        <div>
          <label htmlFor="enrolled-card-icon" className={labelClass}>Icon</label>
          <select id="enrolled-card-icon" className={inputClass} value={settings.icon} onChange={(event) => update({ icon: event.target.value as EnrolledExamCardSettings["icon"] })}>
            {ENROLLED_EXAM_CARD_ICONS.map((icon) => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-dark-900 p-5" aria-label="Card preview">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-600/15 text-primary-500"><EnrolledExamCardIcon icon={settings.icon} /></span>
          <div><p className="text-lg font-extrabold text-heading">{settings.title}</p><p className="mt-1 text-sm text-neutral-400">{settings.subtitle}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => void save()} className={buttonPrimaryClass}>{busy ? "Saving…" : "Save Shortcut Settings"}</button>
          <button type="button" disabled={busy} onClick={() => void save(true)} className="text-sm font-semibold text-slate-500 underline disabled:opacity-50 admin-dark:text-slate-400">Reset to Defaults</button>
        </div>
      </> : !notice ? <p className="text-sm text-slate-500">Loading shortcut settings…</p> : <button type="button" onClick={() => void load()} className={buttonPrimaryClass}>Retry Loading</button>}
      {notice && <p role="status" className={noticeClass(notice)}>{notice.text}</p>}
    </section>
  );
}
