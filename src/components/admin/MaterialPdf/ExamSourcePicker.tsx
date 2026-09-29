"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
};

type StatusFilter = "all" | "draft" | "published";

function answerLetter(idx: number | null | undefined): string {
  if (idx === 0) return "A";
  if (idx === 1) return "B";
  if (idx === 2) return "C";
  if (idx === 3) return "D";
  return "";
}

function toOptions(raw: unknown): [string, string, string, string] {
  const arr = Array.isArray(raw) ? raw.map(String) : [];
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
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  // Load the full uploaded-exam list once (draft + published).
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch("/api/admin/exams", { cache: "no-store", headers: authHeaders })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: { exams?: ExamListItem[] }) => {
        if (!cancelled) setExams(data.exams ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setExams([]);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    };
  }, [exams]);

  const handleLoad = async (mode: "replace" | "append") => {
    if (!selected || loadingQuestions) return;
    setLoadingQuestions(true);
    setQuestionsError(null);
    try {
      const res = await fetch(
        `/api/admin/exams/questions?examId=${encodeURIComponent(selected.id)}`,
        { cache: "no-store", headers: authHeaders },
      );
      if (!res.ok) throw new Error("Failed to load exam questions.");
      const data = (await res.json()) as { questions?: ExamQuestionRow[] };
      const rows = data.questions ?? [];
      // Skip empty placeholder slots (no text and no image).
      const usable = rows.filter(
        (row) => (row.question ?? "").trim().length > 0 || row.questionImage,
      );
      if (usable.length === 0) throw new Error("This exam has no questions yet.");
      const mapped: PdfMaterialQuestion[] = usable.map((row, idx) => ({
        id: uid(`exam-${selected.id}`),
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
      onLoad(sanitizeQuestions(mapped), selected.title, mode);
      setDropdownOpen(false);
    } catch (e) {
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

      {/* Searchable dropdown */}
      <div className="relative mt-3">
        <input
          value={selected ? `${selected.title} (${selected.id})` : search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (selectedId) setSelectedId("");
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search exam — type title / id / subject…"
          className="bangla w-full rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#234e9f] focus:bg-white admin-dark:border-[#1e3a65] admin-dark:bg-[#0a162e] admin-dark:text-white"
        />
        {selectedId && (
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
              <p className="px-4 py-3 text-xs font-semibold text-red-600">
                Failed to load exams. Please retry.
              </p>
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
                      {typeof exam.questionCount === "number" ? ` • ${exam.questionCount} Q` : ""}
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

      {/* Selected exam + load actions */}
      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#dbeafe] bg-[#f8fafc] p-3 admin-dark:border-[#1e3a65] admin-dark:bg-[#0a162e]">
          <span className="min-w-0 flex-1 text-xs font-bold text-slate-700 admin-dark:text-white">
            <span className="bangla">{selected.title}</span>
            <span className="ml-2 font-normal text-slate-500">
              {typeof selected.questionCount === "number" ? `${selected.questionCount} questions` : ""}
              {selected.subject ? ` • ${selected.subject}` : ""}
            </span>
          </span>
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
