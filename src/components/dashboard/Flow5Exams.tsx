"use client";

// Flow 5 — Exam Flow (ADDITIVE; Flows 1-4 untouched).
// Course → 4 Exam Cards → Topic-wise → 8 Subjects → exams
//                       → Paper Final / Subject Final / Final Model → direct lists.
// Same card design + responsive behavior as the existing Course Content cards.
// Exam taking reuses the existing engine (/exam/[id]/rules) unchanged.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import PermissionGate from "@/components/auth/PermissionGate";
import {
  FLOW5_FORMATS,
  FLOW5_SUBJECTS,
  flow5SubjectTitle,
  isFlow5Format,
  type Flow5ExamItem,
  type Flow5Format,
  type Flow5SubjectKey,
} from "@/lib/flow5-shared";

import ExamCard from "@/components/ExamCard";
import { toDhakaDateKey, type PublicExam } from "@/lib/public-exams";
import InfoBox from "@/components/dashboard/InfoBox";

export function examFlowBase(slug: string) {
  return `/dashboard/enrolled-courses/${encodeURIComponent(slug)}/exam-flow`;
}

export function examFlowFormatHref(slug: string, format: Flow5Format) {
  return `${examFlowBase(slug)}/${format}`;
}

export function examFlowSubjectHref(slug: string, subjectKey: Flow5SubjectKey) {
  return `${examFlowBase(slug)}/topic-wise/${encodeURIComponent(subjectKey)}`;
}

function LoadingView({ label }: { label: string }) {
  return (
    <section className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 sm:px-6">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      <p className="mt-4 text-sm font-semibold text-neutral-400">{label}</p>
    </section>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center">
        <p className="font-bold text-red-300">Something went wrong</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-primary-600 px-6 py-3 font-semibold text-white">Try Again</button>
      </div>
    </section>
  );
}

function EmptyExams({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-dark-900/60 p-10 text-center">
      <p className="font-semibold text-heading">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-neutral-400">{hint}</p>
    </div>
  );
}

type CountsState = {
  formats: Record<Flow5Format, number>;
  subjects: Record<Flow5SubjectKey, number>;
} | null;

function useFlow5Counts(slug: string) {
  const { user, authLoading } = useAuth();
  const [counts, setCounts] = useState<CountsState>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    if (!user) return;
    setState("loading");
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/my/flow5?course=${encodeURIComponent(slug)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { counts?: CountsState };
      setCounts(data.counts ?? null);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [user, slug]);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);
  return { counts, state, load };
}

function useFlow5Exams(slug: string, format: Flow5Format, subjectKey?: Flow5SubjectKey | null) {
  const { user, authLoading } = useAuth();
  const [exams, setExams] = useState<Flow5ExamItem[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    if (!user) return;
    setState("loading");
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ course: slug, format });
      if (format === "topic-wise" && subjectKey) params.set("subject", subjectKey);
      const res = await fetch(`/api/my/flow5?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { exams?: Flow5ExamItem[] };
      setExams(Array.isArray(data.exams) ? data.exams : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [user, slug, format, subjectKey]);
  useEffect(() => {
    if (authLoading || !user) return;
    void load();
  }, [authLoading, user, load]);
  return { exams, state, load };
}

const FORMAT_ACCENTS: Record<Flow5Format, string> = {
  "topic-wise": "bg-primary-600/15 text-primary-400 group-hover/card:bg-primary-600 group-hover/card:text-white",
  "paper-final": "bg-violet-500/15 text-violet-400 group-hover/card:bg-violet-500 group-hover/card:text-white",
  "subject-final": "bg-emerald-500/15 text-emerald-400 group-hover/card:bg-emerald-500 group-hover/card:text-white",
  "final-model": "bg-amber-500/15 text-amber-400 group-hover/card:bg-amber-500 group-hover/card:text-white",
};

const FORMAT_ICONS: Record<Flow5Format, React.ReactNode> = {
  "topic-wise": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  "paper-final": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  "subject-final": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
  ),
  "final-model": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.8 21h8.4a2 2 0 002-2V5a2 2 0 00-2-2H8.2a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
};

// ── Course → 4 Exam Cards ──
export function Flow5CourseView({ slug }: { slug: string }) {
  return (
    <PermissionGate requirement="course" courseSlug={slug} loadingLabel="Loading course...">
      <Flow5CourseContent slug={slug} />
    </PermissionGate>
  );
}

function Flow5CourseContent({ slug }: { slug: string }) {
  const { counts, state, load } = useFlow5Counts(slug);
  if (state === "loading" || counts === null) {
    if (state === "error") return <ErrorView onRetry={() => void load()} />;
    return <LoadingView label="Loading exams…" />;
  }
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <InfoBox title="Course Exams" className="mt-4">
        তোমার পরীক্ষার ধরন নির্বাচন করো।
      </InfoBox>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW5_FORMATS.map((format) => (
          <Link
            key={format.key}
            href={examFlowFormatHref(slug, format.key)}
            className="group/card flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl border border-ink/10 bg-dark-900 p-6 text-center shadow-lg shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-primary-600/60 hover:shadow-primary-900/30"
          >
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition ${FORMAT_ACCENTS[format.key]}`}>
              {FORMAT_ICONS[format.key]}
            </span>
            <span className="text-base font-extrabold text-heading group-hover/card:text-primary-400">
              {format.title}
            </span>
            <span className="rounded-full border border-ink/10 bg-ink/5 px-2.5 py-0.5 text-[11px] font-bold text-neutral-400">
              {counts.formats[format.key]} exam{counts.formats[format.key] === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Topic-wise Exam → 8 Subject Cards ──
export function Flow5TopicSubjectsView({ slug }: { slug: string }) {
  return (
    <PermissionGate requirement="course" courseSlug={slug} loadingLabel="Loading course...">
      <Flow5TopicSubjectsContent slug={slug} />
    </PermissionGate>
  );
}

function Flow5TopicSubjectsContent({ slug }: { slug: string }) {
  const { counts, state, load } = useFlow5Counts(slug);
  if (state === "loading" || counts === null) {
    if (state === "error") return <ErrorView onRetry={() => void load()} />;
    return <LoadingView label="Loading subjects…" />;
  }
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <InfoBox title="Topic-wise Exam" className="mt-4">
        পরীক্ষার বিষয় নির্বাচন করো।
      </InfoBox>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW5_SUBJECTS.map((subject, index) => (
          <Link
            key={subject.key}
            href={examFlowSubjectHref(slug, subject.key)}
            className="group/card flex min-h-[130px] flex-col items-center justify-center gap-3 rounded-2xl border border-ink/10 bg-dark-900 p-6 text-center shadow-lg shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-primary-600/60 hover:shadow-primary-900/30"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600/15 text-sm font-black text-primary-400 transition group-hover/card:bg-primary-600 group-hover/card:text-white">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-base font-extrabold leading-snug text-heading group-hover/card:text-primary-400">
              {subject.title}
            </span>
            <span className="rounded-full border border-ink/10 bg-ink/5 px-2.5 py-0.5 text-[11px] font-bold text-neutral-400">
              {counts.subjects[subject.key]} exam{counts.subjects[subject.key] === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Direct exam list (Paper Final / Subject Final / Final Model)
//     + Topic-wise per-subject list. Unified Exam System: SAME complete engine
//     as Public Exams (/exam/[id]/rules → timer → result); only the access
//     scope differs (COURSE → enrolled students, inside Course Content). ──

function courseItemToPublicExam(item: Flow5ExamItem): PublicExam {
  const scheduledIso = item.scheduledAt;
  return {
    id: item.id,
    name: item.title,
    description: item.description ?? null,
    bannerUrl: null,
    examMode: item.examMode,
    batch: "",
    courseType: item.courseType,
    subject: item.subject,
    totalMarks: item.totalMarks,
    totalQuestions: item.totalQuestions,
    durationMinutes: item.durationMinutes,
    negativeMarks: item.marksPerQuestion || 0,
    negativeEnabled: item.negativeEnabled,
    negativePerWrong: item.negativePerWrong || 0,
    scheduledAt: scheduledIso,
    endsAt: item.endsAt,
    examDate: toDhakaDateKey(scheduledIso),
    examTime: "",
    status: item.phase === "upcoming" ? "Upcoming" : item.phase === "live" ? "Live" : item.phase === "practice" ? "Archived" : "Expired",
    published: true,
    secondTimerEnabled: item.secondTimerEnabled,
    secondTimerDeduction: item.secondTimerDeduction,
    eligibility: { mode: "all", rules: [] },
    categoryId: null,
  };
}

export function Flow5ExamListView({
  slug,
  format,
  subjectKey,
}: {
  slug: string;
  format: Flow5Format;
  subjectKey?: Flow5SubjectKey | null;
}) {
  if (!isFlow5Format(format)) return null;
  return (
    <PermissionGate requirement="course" courseSlug={slug} loadingLabel="Loading course...">
      <Flow5ExamListContent slug={slug} format={format} subjectKey={subjectKey ?? null} />
    </PermissionGate>
  );
}

function Flow5ExamListContent({
  slug,
  format,
  subjectKey,
}: {
  slug: string;
  format: Flow5Format;
  subjectKey: Flow5SubjectKey | null;
}) {
  const { exams, state, load } = useFlow5Exams(slug, format, subjectKey);
  if (state === "loading" || exams === null) return <LoadingView label="Loading exams…" />;
  if (state === "error") return <ErrorView onRetry={() => void load()} />;

  const meta = FLOW5_FORMATS.find((f) => f.key === format);
  const isTopic = format === "topic-wise";
  const heading = isTopic && subjectKey ? flow5SubjectTitle(subjectKey) : (meta?.title ?? "Exams");

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <InfoBox title={heading} className="mt-4">
        পরীক্ষা শুরু করতে Start Exam বাটনে ক্লিক করো।
      </InfoBox>
      {exams.length === 0 ? (
        <EmptyExams
          title="No exams available yet."
          hint={isTopic ? "No topic-wise exams have been published for this subject yet." : `No ${heading.toLowerCase()} have been published for this course yet.`}
        />
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {exams.map((exam) => (
            <ExamCard key={exam.id} exam={courseItemToPublicExam(exam)} />
          ))}
        </div>
      )}
    </section>
  );
}
