"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import ExamCard from "@/components/ExamCard";
import { toDhakaDateKey, type PublicExam, type ExamStatus } from "@/lib/public-exams";

type MyExam = {
  id: string;
  title: string;
  subject: string;
  courseType: "Academic" | "Admission";
  totalMarks: number;
  durationMinutes: number;
  questionCount?: number;
  negativeMarks?: number;
  scheduledAt: string | null;
  endsAt?: string | null;
  phase?: string;
  status: ExamStatus;
};

function toPublicExam(exam: MyExam): PublicExam {
  const scheduledIso = exam.scheduledAt ?? "";
  const schedMs = scheduledIso ? new Date(scheduledIso).getTime() : NaN;
  const hasValidSchedule = Number.isFinite(schedMs);
  const isAdmission = exam.courseType === "Admission";
  const neg = exam.negativeMarks !== undefined
    ? Math.max(0, Number(exam.negativeMarks) || 0)
    : isAdmission
      ? 0.25
      : 0;
  return {
    id: exam.id,
    name: exam.title,
    batch: "",
    courseType: exam.courseType,
    subject: exam.subject,
    totalMarks: exam.totalMarks,
    totalQuestions: Math.max(0, Number(exam.questionCount) || 0),
    durationMinutes: exam.durationMinutes,
    negativeMarks: neg,
    negativeEnabled: neg > 0,
    negativePerWrong: neg,
    scheduledAt: exam.scheduledAt ?? null,
    endsAt: exam.endsAt ?? null,
    examMode: "live",
    examDate: toDhakaDateKey(scheduledIso || null),
    examTime: hasValidSchedule
      ? new Date(scheduledIso).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: "Asia/Dhaka",
        })
      : "",
    status: exam.status,
    published: true,
    secondTimerEnabled: false,
    secondTimerDeduction: 0,
    eligibility: { mode: "all", rules: [] },
  };
}

/**
 * Enrolled-kind exams the logged-in student may take — shown above the
 * public list on /exam. Requires login + course enrollment (server-checked).
 */
export default function MyEnrolledExams() {
  const { user, authLoading } = useAuth();
  const [exams, setExams] = useState<MyExam[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setExams(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/exams/mine", {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as {
          exams?: MyExam[];
        };
        if (!cancelled) setExams(data.exams ?? []);
      } catch {
        if (!cancelled) setExams([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  if (!exams || exams.length === 0) return null;

  // Live/upcoming first, missed-live (practice) grouped below with a hint.
  const practiceExams = exams.filter(
    (exam) => exam.status === "Practice" || exam.status === "Archived" || exam.phase === "archived" || exam.phase === "practice",
  );
  const activeExams = exams.filter((exam) => !practiceExams.includes(exam));

  return (
    <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <h2 className="text-xl font-extrabold tracking-tight text-heading">
        My Enrolled Exams
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Exams included with the courses you are enrolled in.
      </p>
      {activeExams.length > 0 && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {activeExams.map((exam) => (
            <ExamCard key={exam.id} exam={toPublicExam(exam)} />
          ))}
        </div>
      )}
      {practiceExams.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-violet-400">
            Practice — Missed Live ({practiceExams.length})
          </h3>
          <p className="mt-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold leading-relaxed text-violet-300">
            Live time শেষ হয়ে গেলেও এই exam গুলো practice হিসেবে দিতে পারবে — practice attempt
            leaderboard বা merit position-এ কোনো effect ফেলবে না।
          </p>
          <div className="mt-3 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {practiceExams.map((exam) => (
              <ExamCard key={exam.id} exam={toPublicExam(exam)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
