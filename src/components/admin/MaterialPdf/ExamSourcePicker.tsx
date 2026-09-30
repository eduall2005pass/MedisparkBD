"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PdfMaterialQuestion } from "@/lib/pdf-materials";
import { sanitizeQuestions } from "@/lib/material-pdf-utils";

type ExamListItem = {
  id: string;
  title: string;
  subject?: string;
  status?: string;
  kind?: string;
  questionCount?: number;
  totalMarks?: number;
};

type ExamQuestionRow = {
  id: number | null;
  subject?: string;
  question?: string;
  questionImage?: string | null;
  options?: unknown;
  correctIndex?: number | null;
  explanation?: string | null;
  hasVariant?: boolean;
  order?: number;
};

type LangVersion = "bangla" | "english";
type SetLabel = "A" | "B";

const VERSIONS: LangVersion[] = ["bangla", "english"];
const SETS: SetLabel[] = ["A", "B"];

type StatusFilter = "all" | "draft" | "published" | "closed";

function answerLetter(idx: number | string | null | undefined): string {
  if (idx === null || idx === undefined) return "";
  // Base rows may carry the index as a numeric string; normalize before compare.
  const n = typeof idx === "string" ? Number(idx.trim()) : Number(idx);
  if (n === 0) return "A";
  if (n === 1) return "B";
  if (n === 2) return "C";
  if (n === 3) return "D";
  return "";
}

function toOptions(raw: unknown): [string, string, string, string] {
  let arr: string[] = [];
  if (Array.isArray(raw)) {
    arr = raw.map(String);
  } else if (typeof raw === "string" && raw.trim()) {
    // Defensive: options sometimes arrive as a JSON string (legacy callers).
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) arr = parsed.map(String);
    } catch {
      arr = [];
    }
  }
  return [arr[0] ?? "", arr[1] ?? "", arr[2] ?? "", arr[3] ?? ""];
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function ExamSourcePicker({
  authHeaders,
  onLoad,
}: {
  authHeaders: Record<string, string>;
  onLoad: (
    questions: PdfMaterialQuestion[],
    examTitle: string,
    mode: "replace" | "append",
  ) => void;
}) {
  const [exams, setExams] = useState<ExamListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [langVersion, setLangVersion] = useState<LangVersion>("bangla");
  const [setLabel, setSetLabel] = useState<SetLabel>("A");
  const [coverage, setCoverage] = useState<Record<string, number> | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Guards handleLoad against stale wins when user switches exam mid-flight.
  // NOTE: never assign ref during render (React 19 strict warns/loops) — sync in effect.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);
  // Stable key for auth headers so token rotation triggers a refetch.
  // Memoize so JSON.stringify doesn't produce a new dep identity every render.
  const authKey = useMemo(() => JSON.stringify(authHeaders), [authHeaders]);

  const mapRows = (rows: ExamQuestionRow[], examId: string): PdfMaterialQuestion[] =>
    rows.map((row, idx) => ({
      id: uid(`exam-${examId}`),
      qNumber: idx + 1,
      question: row.question ?? "",
      options: toOptions(row.options),
      answer: answerLetter(row.correctIndex),
      needsReview: false,
      issues: [],
      image: row.questionImage
        ? { dataUrl: row.questionImage, name: `exam-image-${idx + 1}`, widthPercent: 100 }
        : null,
      isStandaloneImage: false,
      topic: row.subject?.trim() ? row.subject.trim() : undefined,
    }));

  // Close dropdown on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Load the full uploaded-exam list (draft + published + closed).
  // Refetches when auth headers rotate; exposes Retry on failure.
  // useCallback so the mount effect below doesn't get a new fn identity each render.
  const loadExams = useCallback(() => {
    setLoadError(false);
    fetch("/api/admin/exams", { cache: "no-store", headers: authHeaders })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: { exams?: ExamListItem[] }) => {
        setExams(data.exams ?? []);
      })
      .catch(() => {
        setExams([]);
        setLoadError(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  const filtered = useMemo(() => {
    const list = exams ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((exam) => {
      if (statusFilter !== "all" && (exam.status ?? "") !== statusFilter) return false;
      if (!q) return true;
      const hay = `${exam.title ?? ""} ${exam.id ?? ""} ${exam.subject ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [exams, search, statusFilter]);

  const selected = useMemo(
    () => (exams ?? []).find((e) => e.id === selectedId) ?? null,
    [exams, selectedId],
  );

  const counts = useMemo(() => {
    const list = exams ?? [];
    return {
      all: list.length,
      draft: list.filter((e) => e.status === "draft").length,
      published: list.filter((e) => e.status === "published").length,
      closed: list.filter((e) => e.status === "closed").length,
    };
  }, [exams]);

  // Variant coverage for the selected exam (which version/set actually has content).
  // Reset per-exam state on every switch so stale coverage never leaks across exams.
  useEffect(() => {
    setCoverage(null);
    setCoverageLoading(false);
    setLoadedSource(null);
    setPartialWarning(null);
    setQuestionsError(null);
    if (!selectedId) {
      return;
    }
    let cancelled = false;
    setCoverageLoading(true);
    fetch(`/api/admin/exams/variants?examId=${encodeURIComponent(selectedId)}`, {
      cache: "no-store",
      headers: authHeaders,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { coverage?: Record<string, number> } | null) => {
        if (!cancelled && data?.coverage) setCoverage(data.coverage);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCoverageLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, authKey]);

  const fetchUsable = async (
    examId: string,
    version: LangVersion,
    set: SetLabel,
  ): Promise<ExamQuestionRow[]> => {
    const res = await fetch(
      `/api/admin/exams/questions?examId=${encodeURIComponent(examId)}&version=${version}&set=${set}`,
      { cache: "no-store", headers: authHeaders },
    );
    if (!res.ok) throw new Error("Failed to load exam questions.");
    const data = (await res.json()) as { questions?: ExamQuestionRow[] };
    const rows = data.questions ?? [];
    // Skip empty placeholder slots (no text and no image).
    return rows.filter(
      (row) => (row.question ?? "").trim().length > 0 || row.questionImage,
    );
  };

  const handleLoad = async (mode: "replace" | "append") => {
    if (!selected || loadingQuestions) return;
    const requestedId = selected.id;
    const requestedTitle = selected.title;
    const requestedVersion = langVersion;
    const requestedSet = setLabel;
    setLoadingQuestions(true);
    setQuestionsError(null);
    setPartialWarning(null);
    setLoadedSource(null);
    try {
      // Prefer coverage order: requested combo first, then fullest coverage,
      // so we usually fetch 1 combo. Fall back to scanning all 4 on miss.
      const coverageOrder = [...VERSIONS.flatMap((v) => SETS.map((s) => ({ v, s })))]
        .sort((a, b) => (coverage?.[`${b.v}/${b.s}`] ?? 0) - (coverage?.[`${a.v}/${a.s}`] ?? 0));
      const combos: { v: LangVersion; s: SetLabel }[] = [
        { v: requestedVersion, s: requestedSet },
        ...coverageOrder.filter((c) => !(c.v === requestedVersion && c.s === requestedSet)),
      ];
      // Fast path: try requested combo first.
      let bestRows: ExamQuestionRow[] = [];
      let bestKey = `${requestedVersion}/${requestedSet}`;
      let failed = 0;
      try {
        bestRows = await fetchUsable(requestedId, requestedVersion, requestedSet);
      } catch {
        failed += 1;
      }
      // If requested combo is empty/failed, scan the rest for the fullest one.
      if (bestRows.length === 0) {
        const rest = combos.slice(1);
        const settled = await Promise.allSettled(
          rest.map(async ({ v, s }) => ({ key: `${v}/${s}`, rows: await fetchUsable(requestedId, v, s) })),
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value.rows.length > bestRows.length) {
            bestRows = r.value.rows;
            bestKey = r.value.key;
          } else if (r.status === "rejected") {
            failed += 1;
          }
        }
      }
      if (bestRows.length === 0) throw new Error("This exam has no questions yet.");
      // Stale guard: user switched exam mid-flight — drop this result.
      if (selectedIdRef.current !== requestedId) return;
      const usable = bestRows;
      const [bv, bs] = bestKey.split("/");
      const usedVersion = (bv === "bangla" || bv === "english" ? bv : langVersion) as LangVersion;
      const usedSet = (bs === "A" || bs === "B" ? bs : setLabel) as SetLabel;
      setLangVersion(usedVersion);
      setSetLabel(usedSet);
      const mapped = mapRows(usable, requestedId);
      onLoad(sanitizeQuestions(mapped), requestedTitle, mode);
      const autoSwitched = bestKey !== `${requestedVersion}/${requestedSet}`;
      setLoadedSource(
        autoSwitched
          ? `auto-picked ${bestKey} (${usable.length} Q, most complete)`
          : `${bestKey} • ${usable.length} Q`,
      );
      if (failed > 0 && bestRows.length > 0) {
        setPartialWarning(`${failed} version/set failed to load — showing most complete (${bestKey}).`);
      }
      setDropdownOpen(false);
    } catch (e) {
      if (selectedIdRef.current !== requestedId) return;
      setQuestionsError(e instanceof Error ? e.message : "Failed to load exam questions.");
    } finally {
      setLoadingQuestions(false);
    }
  };

  return (
    <div ref={wrapRef}>
      {/* Status filter */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: "all", label: `All (${counts.all})` },
            { key: "draft", label: `Draft (${counts.draft})` },
            { key: "published", label: `Published (${counts.published})` },
            { key: "closed", label: `Closed (${counts.closed})` },
          ] as { key: StatusFilter; label: string }[]
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setStatusFilter(f.key);
              setDropdownOpen(true);
            }}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
              statusFilter === f.key
                ? "bg-[#0b1e3a] text-white shadow admin-dark:bg-[#234e9f]"
                : "border border-[#cbd5e1] bg-white text-slate-600 hover:bg-slate-100 admin-dark:border-[#1e3a65] admin-dark:bg-[#0a162e] admin-dark:text-[#8da0c0]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-slate-500 admin-dark:text-slate-400">
          {exams === null ? "Loading exams…" : `${filtered.length} exam${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>
      {loadError && (
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 admin-dark:border-red-900/40 admin-dark:bg-red-900/20 admin-dark:text-red-300">
          <span className="flex-1">Failed to load exams. Check connection / admin access.</span>
          <button
            type="button"
            onClick={loadExams}
            className="rounded-lg bg-red-600 px-3 py-1 text-[11px] font-extrabold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Searchable dropdown — search field is separate from the selected chip below */}
      <div className="relative mt-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder={
            selected ? `${selected.title} (${selected.id}) — selected, search to change…` : "Search exam — type title / id / subject…"
          }
          className="bangla w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#234e9f] focus:bg-white admin-dark:border-[#1e3a65] admin-dark:bg-[#0a162e] admin-dark:text-white"
        />
        {(selectedId || search) && (
          <button
            type="button"
            onClick={() => {
              setSelectedId("");
              setSearch("");
              setDropdownOpen(true);
            }}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full border border-[#cbd5e1] bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50 admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547] admin-dark:text-white"
            title="Clear selection"
          >
            ✕
          </button>
        )}
        {dropdownOpen && (
          <div className="absolute right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-[#cbd5e1] bg-white shadow-xl admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547]">
            {exams === null ? (
              <p className="px-4 py-3 text-xs text-slate-500">Loading exams…</p>
            ) : loadError ? (
              <div className="flex items-center gap-2 px-4 py-3">
                <p className="flex-1 text-xs font-semibold text-red-600">
                  Failed to load exams. Please retry.
                </p>
                <button
                  type="button"
                  onClick={loadExams}
                  className="rounded-lg bg-red-600 px-3 py-1 text-[11px] font-extrabold text-white hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-slate-500">
                No exams found — try another keyword or filter.
              </p>
            ) : (
              filtered.slice(0, 60).map((exam) => (
                <button
                  key={exam.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(exam.id);
                    setSearch("");
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left transition hover:bg-slate-50 admin-dark:hover:bg-white/5 ${
                    selectedId === exam.id ? "bg-[#0b1e3a]/5 admin-dark:bg-white/10" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold text-[#0b1e3a] admin-dark:text-white">
                      {exam.title}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 admin-dark:text-slate-400">
                      {exam.id}
                      {exam.subject ? ` • ${exam.subject}` : ""}
                      {typeof exam.questionCount === "number" ? ` • ${exam.questionCount} slots` : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                      exam.status === "published"
                        ? "bg-emerald-100 text-emerald-700 admin-dark:bg-emerald-900/30 admin-dark:text-emerald-300"
                        : exam.status === "closed"
                          ? "bg-slate-200 text-slate-600 admin-dark:bg-white/10 admin-dark:text-slate-300"
                          : "bg-amber-100 text-amber-700 admin-dark:bg-amber-900/30 admin-dark:text-amber-300"
                    }`}
                  >
                    {exam.status ?? "draft"}
                  </span>
                </button>
              ))
            )}
            {filtered.length > 60 && (
              <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                Showing first 60 — refine search to narrow down.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Selected exam + version/set + load actions */}
      {selected && (
        <div className="mt-3 rounded-xl border border-[#dbeafe] bg-[#f8fafc] p-3 admin-dark:border-[#1e3a65] admin-dark:bg-[#0a162e]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-xs font-bold text-slate-700 admin-dark:text-white">
              <span className="bangla">{selected.title}</span>
              <span className="ml-2 font-normal text-slate-500">
                {typeof selected.questionCount === "number" ? `${selected.questionCount} slots` : ""}
                {selected.subject ? ` • ${selected.subject}` : ""}
              </span>
            </span>
            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 admin-dark:text-slate-300">
              Version
              <select
                value={langVersion}
                disabled={loadingQuestions}
                onChange={(e) => setLangVersion(e.target.value as LangVersion)}
                className="rounded-lg border border-[#cbd5e1] bg-white px-2 py-1 text-[11px] font-bold text-[#0b1e3a] outline-none disabled:opacity-50 admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547] admin-dark:text-white"
              >
                <option value="bangla">Bangla</option>
                <option value="english">English</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 admin-dark:text-slate-300">
              Set
              <select
                value={setLabel}
                disabled={loadingQuestions}
                onChange={(e) => setSetLabel(e.target.value as SetLabel)}
                className="rounded-lg border border-[#cbd5e1] bg-white px-2 py-1 text-[11px] font-bold text-[#0b1e3a] outline-none disabled:opacity-50 admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547] admin-dark:text-white"
              >
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </label>
          </div>
          {coverageLoading && (
            <p className="mt-1.5 text-[11px] text-slate-400">Checking version/set content…</p>
          )}
          {coverage && (
            <p className="mt-1.5 text-[11px] text-slate-500 admin-dark:text-slate-400">
              Content: Bangla/A {coverage["bangla:A"] ?? 0} • Bangla/B {coverage["bangla:B"] ?? 0} • English/A {coverage["english:A"] ?? 0} • English/B {coverage["english:B"] ?? 0}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleLoad("replace")}
              disabled={loadingQuestions}
              className="rounded-xl bg-[#0b1e3a] px-4 py-2 text-xs font-extrabold text-white shadow hover:bg-[#123060] disabled:opacity-40 admin-dark:bg-[#234e9f]"
            >
              {loadingQuestions ? "Loading…" : "Load → Replace"}
            </button>
            <button
              type="button"
              onClick={() => void handleLoad("append")}
              disabled={loadingQuestions}
              className="rounded-xl border border-[#cbd5e1] bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547] admin-dark:text-white"
            >
              + Append
            </button>
            {loadedSource && (
              <span className="text-[11px] font-bold text-emerald-700 admin-dark:text-emerald-300">
                Loaded {loadedSource}
              </span>
            )}
            {partialWarning && (
              <span className="text-[11px] font-semibold text-amber-600 admin-dark:text-amber-300">
                {partialWarning}
              </span>
            )}
          </div>
        </div>
      )}
      {questionsError && (
        <p className="mt-2 text-xs font-semibold text-red-600">{questionsError}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500 admin-dark:text-slate-400">
        Replace pasted content-এর বদলে exam লোড করবে, Append হলে নিচে যোগ হবে — তারপর নিচের A4 preview-এ edit করে Generate PDF।
      </p>
    </div>
  );
}
