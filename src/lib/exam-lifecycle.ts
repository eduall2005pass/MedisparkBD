import type { Exam } from "@/lib/exams-admin";

/**
 * Shared exam lifecycle — single source of truth for time-based status.
 * Pure + client-safe (no DB). All server code must compute status from the
 * stored Start/End date-time with the server clock — never a frontend-only
 * timer — so refresh / restart / late-open all resolve correctly.
 *
 * Public Live Exam:  Upcoming → Live → Practice Exam (after End Time)
 * Public Practice:   always Available (never time-gated)
 * Course Exam:       Draft → Upcoming → Live → Archived
 *
 * Post-live practice is automatic (server time): once the configured live
 * window ends, the exam becomes a Practice Exam — students can still Start
 * Exam and submit, but those attempts are recorded as practice and are
 * never ranked (see updateMeritPositions / attempt_type='practice').
 * Admin-closed exams keep the Closed → Hidden flow (explicit admin intent).
 */

export const PUBLIC_LIVE_CLOSED_VISIBLE_MS = 12 * 60 * 60 * 1000;
export const COURSE_CLOSED_VISIBLE_MS = 24 * 60 * 60 * 1000;

export type PublicLiveState = "draft" | "upcoming" | "live" | "closed" | "hidden" | "practice";
export type CourseState = "draft" | "upcoming" | "live" | "archived" | "no-window";

/** Canonical course/enrolled phase set. "practice" is a legacy alias of "archived". */
export type CanonicalCoursePhase = CourseState | "practice";

export function normalizeCoursePhase(phase: string | null | undefined): CourseState | null {
  if (phase === "practice") return "archived";
  if (phase === "draft" || phase === "upcoming" || phase === "live" || phase === "archived" || phase === "no-window") return phase;
  return null;
}

type ExamTime = Pick<Exam, "kind" | "examMode" | "status" | "scheduledAt" | "endsAt">;

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** PUBLIC scope + practice mode = always-available practice exam. */
export function isPublicPracticeExam(exam: Pick<ExamTime, "kind" | "examMode">): boolean {
  if ((exam as { kind?: string }).kind === "enrolled") return false;
  return (exam as { examMode?: string }).examMode === "practice";
}

/** PUBLIC scope + live mode = scheduled live exam with Upcoming/Live/Closed/Hidden. */
export function isPublicLiveExam(exam: Pick<ExamTime, "kind" | "examMode">): boolean {
  if ((exam as { kind?: string }).kind === "enrolled") return false;
  return (exam as { examMode?: string }).examMode !== "practice";
}

export function getPublicLiveState(
  exam: ExamTime,
  nowMs: number = Date.now(),
): PublicLiveState {
  if (exam.status === "draft") return "draft";
  if (isPublicPracticeExam(exam)) return "practice";
  // Stored admin-closed behaves as Closed (never auto-moves to Practice).
  const startMs = toMs(exam.scheduledAt);
  const endMs = toMs(exam.endsAt);
  if (exam.status === "closed") {
    if (endMs !== null && nowMs - endMs > PUBLIC_LIVE_CLOSED_VISIBLE_MS) return "hidden";
    return "closed";
  }
  if (startMs !== null && nowMs < startMs) return "upcoming";
  // Past the configured end time → automatic Practice Exam phase: still
  // startable/completable, but attempts are unranked practice attempts.
  if (endMs !== null && nowMs >= endMs) {
    return "practice";
  }
  return "live";
}

/** True when a Public Live Exam must disappear from the Main Website list (admin-closed + 12h after End). Post-live practice exams are never hidden. */
export function isPublicLiveHidden(exam: ExamTime, nowMs: number = Date.now()): boolean {
  if (!isPublicLiveExam(exam)) return false;
  return getPublicLiveState(exam, nowMs) === "hidden";
}

/** True when a Public Live Exam card stays visible on the website (Upcoming/Live/post-live Practice/admin-closed≤12h). */
export function isPublicLiveVisible(exam: ExamTime, nowMs: number = Date.now()): boolean {
  if (!isPublicLiveExam(exam)) return false;
  const state = getPublicLiveState(exam, nowMs);
  return state === "upcoming" || state === "live" || state === "practice" || state === "closed";
}

/** True when a public live-mode exam is in its automatic post-live Practice phase (past End Time, not admin-closed). Practice attempts are unranked. */
export function isPublicPostLivePractice(exam: ExamTime, nowMs: number = Date.now()): boolean {
  if (!isPublicLiveExam(exam)) return false;
  if (exam.status === "closed" || exam.status === "draft") return false;
  const endMs = toMs(exam.endsAt);
  return endMs !== null && nowMs >= endMs;
}

export function getCourseState(exam: ExamTime, nowMs: number = Date.now()): CourseState {
  if (exam.status === "draft") return "draft";
  const startMs = toMs(exam.scheduledAt);
  const endMs = toMs(exam.endsAt);
  if (startMs === null && endMs === null) return "no-window";
  if (startMs !== null && nowMs < startMs) return "upcoming";
  if (endMs !== null && nowMs >= endMs) return "archived";
  return "live";
}

/** Archived practice attempts must NOT affect official merit/ranking. */
export function isCoursePracticePhase(phase: string | null | undefined): boolean {
  return phase === "archived" || phase === "practice";
}
