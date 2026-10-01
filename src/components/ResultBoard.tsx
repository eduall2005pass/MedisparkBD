"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibleInterval } from "@/lib/use-visible-interval";

type BoardRow = {
  resultId: number;
  examId: string;
  examTitle: string;
  examKind: string;
  rank: number | null;
  studentName: string;
  studentId: string | null;
  institution: string | null;
  obtained: number;
  totalMarks: number;
  percent: number;
  correctCount: number | null;
  wrongCount: number | null;
  skippedCount: number | null;
  accuracy: number | null;
  timeTakenSeconds: number | null;
  submittedAt: string;
  submissionType: "manual" | "auto";
  isSecondTimer: boolean;
};

type ExamOption = { id: string; title: string; kind: string };

function formatTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka",
  });
}

function toCsv(rows: BoardRow[]): string {
  const head = [
    "Exam", "Kind", "Rank", "Student", "Student ID", "College",
    "Obtained", "Total", "Percent", "Correct", "Wrong", "Skipped",
    "Accuracy %", "Time", "Submitted", "Submit Type",
  ];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.examTitle, r.examKind, r.rank ?? "", r.studentName, r.studentId ?? "",
      r.institution ?? "", r.obtained, r.totalMarks, r.percent,
      r.correctCount ?? "", r.wrongCount ?? "", r.skippedCount ?? "",
      r.accuracy ?? "", r.timeTakenSeconds ?? "", formatDate(r.submittedAt),
      r.submissionType,
    ].map(esc).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export default function ResultBoard() {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examId, setExamId] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const limit = 20;
  const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
  // Searchable exam dropdown.
  const [examOpen, setExamOpen] = useState(false);
  const [examSearch, setExamSearch] = useState("");
  const examBoxRef = useRef<HTMLDivElement>(null);
  const selectedExam = exams.find((e) => e.id === examId) ?? null;
  const filteredExams = examSearch.trim()
    ? exams.filter((e) =>
        e.title.toLowerCase().includes(examSearch.trim().toLowerCase()),
      )
    : exams;

  useEffect(() => {
    if (!examOpen) return;
    const onClick = (event: MouseEvent) => {
      if (
        examBoxRef.current &&
        !examBoxRef.current.contains(event.target as Node)
      ) {
        setExamOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExamOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [examOpen]);

  const pickExam = (id: string) => {
    setExamId(id);
    setPage(1);
    setExamOpen(false);
    setExamSearch("");
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/results?exams=1", { cache: "no-store" });
        const data = (await res.json()) as { exams?: ExamOption[] };
        if (Array.isArray(data.exams)) setExams(data.exams);
      } catch {}
    })();
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (examId) sp.set("examId", examId);
      if (debouncedQ) sp.set("q", debouncedQ);
      const res = await fetch(`/api/results?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as {
        results?: BoardRow[];
        total?: number;
      };
      setRows(Array.isArray(data.results) ? data.results : []);
      setTotal(Number(data.total) || 0);
      setLastUpdated(new Date());
    } catch {
      if (!silent) {
        setRows([]);
        setTotal(0);
      }
      setLoadError("Could not load results. Please retry.");
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, [examId, debouncedQ, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto refresh every 5 minutes, visible tabs only (background tabs cost zero).
  const silentReload = useCallback(() => void load({ silent: true }), [load]);
  useVisibleInterval(silentReload, AUTO_REFRESH_MS);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const exportCsv = () => {
    const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medispark-results-p${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Filters */}
      <div className="rounded-2xl border border-ink/10 bg-dark-900/60 p-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
          <div>
            <label htmlFor="result-q" className="mb-1 block text-xs font-bold uppercase tracking-widest text-neutral-500">
              Student ID / নাম / কলেজ দিয়ে খুঁজুন
            </label>
            <input
              id="result-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="যেমন: MS-AB12CD34, Rahim, Dhaka College…"
              className="w-full rounded-xl border border-ink/10 bg-dark-950 px-4 py-2.5 text-sm text-heading outline-none transition placeholder:text-neutral-600 focus:border-primary-500/60"
            />
          </div>
          <div ref={examBoxRef} className="relative">
            <label htmlFor="result-exam-search" className="mb-1 block text-xs font-bold uppercase tracking-widest text-neutral-500">
              পরীক্ষা
            </label>
            <div className="relative">
              <input
                id="result-exam-search"
                value={examOpen ? examSearch : (selectedExam?.title ?? "")}
                onChange={(e) => {
                  setExamSearch(e.target.value);
                  if (!examOpen) setExamOpen(true);
                }}
                onFocus={() => {
                  setExamSearch("");
                  setExamOpen(true);
                }}
                placeholder={`পরীক্ষা খুঁজুন… (${exams.length}টি)`}
                autoComplete="off"
                className="w-full rounded-xl border border-ink/10 bg-dark-950 px-4 py-2.5 pr-16 text-sm text-heading outline-none transition placeholder:text-neutral-600 focus:border-primary-500/60"
              />
              {examId && (
                <button
                  type="button"
                  aria-label="Clear exam filter"
                  onClick={() => pickExam("")}
                  className="absolute right-9 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-neutral-500 transition hover:text-heading"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                aria-label={examOpen ? "Close exam list" : "Open exam list"}
                aria-expanded={examOpen}
                onClick={() => {
                  setExamSearch("");
                  setExamOpen((o) => !o);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-neutral-400 transition hover:text-heading"
              >
                {examOpen ? "▲" : "▼"}
              </button>
            </div>
            {examOpen && (
              <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-ink/10 bg-dark-950 shadow-2xl shadow-black/50">
                <li>
                  <button
                    type="button"
                    onClick={() => pickExam("")}
                    className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-primary-600/10 ${
                      !examId ? "font-bold text-primary-400" : "text-heading"
                    }`}
                  >
                    সব পরীক্ষা ({total}টি ফল)
                  </button>
                </li>
                {filteredExams.length === 0 ? (
                  <li className="px-4 py-3 text-center text-xs text-neutral-500">
                    “{examSearch}” নামে পরীক্ষা নেই
                  </li>
                ) : (
                  filteredExams.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => pickExam(e.id)}
                        className={`block w-full truncate px-4 py-2.5 text-left text-sm transition hover:bg-primary-600/10 ${
                          e.id === examId
                            ? "font-bold text-primary-400"
                            : "text-neutral-300"
                        }`}
                        title={e.title}
                      >
                        {e.title}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="w-full rounded-xl border border-primary-500/40 bg-primary-600/10 px-4 py-2.5 text-sm font-bold text-primary-400 transition hover:bg-primary-600/20 disabled:opacity-40 md:w-auto"
            >
              Excel (CSV)
            </button>
          </div>
        </div>
      </div>

      {/* Live status */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-500/25 bg-gradient-to-r from-primary-600/10 to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <p className="text-xs font-semibold text-neutral-300">
            {refreshing ? (
              <span className="text-emerald-400">আপডেট হচ্ছে…</span>
            ) : (
              <>
                অটো-আপডেট{" "}
                <span className="font-bold text-emerald-400">৫ মিনিট পর পর</span>
              </>
            )}
            {lastUpdated && (
              <span className="ml-2 font-normal text-neutral-500">
                · সর্বশেষ: {lastUpdated.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load({ silent: true })}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-ink/5 px-3 py-1.5 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 hover:text-primary-400 disabled:opacity-50"
        >
          <span className={refreshing ? "animate-spin" : ""}>⟳</span>
          এখনই রিফ্রেশ
        </button>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-dark-900 text-xs uppercase tracking-wider text-neutral-400">
              {["Rank", "Student", "Student ID", "College", "Exam", "Score", "%", "✓/✗/–", "Accuracy", "Time", "Submitted"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-3 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-neutral-500">
                  লোড হচ্ছে…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-red-400">
                  {loadError}{" "}
                  <button type="button" onClick={() => void load()} className="ml-2 font-bold underline">
                    Retry
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-neutral-500">
                  কোনো ফল পাওয়া যায়নি। অন্য ID বা পরীক্ষা দিয়ে দেখুন।
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.resultId} className="border-t border-ink/10 transition hover:bg-primary-600/5">
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold text-primary-400">
                    {r.rank ?? "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 font-semibold text-heading">
                    {r.studentName}
                    {r.isSecondTimer && (
                      <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                        2nd
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-neutral-300">
                    {r.studentId ?? "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-neutral-400">
                    {r.institution ?? "—"}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-neutral-300" title={r.examTitle}>
                    {r.examTitle}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-bold text-heading">
                    {r.obtained}/{r.totalMarks}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-neutral-300">
                    {r.percent}%
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    <span className="text-emerald-400">{r.correctCount ?? "—"}</span>
                    <span className="text-neutral-600">/</span>
                    <span className="text-red-400">{r.wrongCount ?? "—"}</span>
                    <span className="text-neutral-600">/</span>
                    <span className="text-neutral-400">{r.skippedCount ?? "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-neutral-300">
                    {r.accuracy !== null ? `${r.accuracy}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-neutral-400">
                    {formatTime(r.timeTakenSeconds)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-neutral-500">
                    {formatDate(r.submittedAt)}
                    {r.submissionType === "auto" && (
                      <span className="ml-1 text-[10px]">(auto)</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          পেজ {page}/{totalPages} · মোট {total}টি ফল
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-ink/10 bg-ink/5 px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 disabled:opacity-40"
          >
            ← আগের
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-ink/10 bg-ink/5 px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 disabled:opacity-40"
          >
            পরের →
          </button>
        </div>
      </div>
    </div>
  );
}
