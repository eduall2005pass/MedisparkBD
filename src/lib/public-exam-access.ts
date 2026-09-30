import { fetchExams } from "@/lib/exams-admin";
import { query } from "@/lib/mysql";
import { deriveStatus } from "@/lib/public-exams";

/**
 * Public exam access — thin wrapper over the shared exam engine.
 *
 * MASTER PROMPT §50 — "DO NOT build separate exam engines" rule:
 * There is a SINGLE engine (`getExamForTaking` / `fetchExams`) and TWO
 * distinct access services that guard it. This file is the PUBLIC path.
 *
 * Enrolled-kind exams are NEVER accessible via the public path, even when
 * published/live. Public exams are viewable by anyone, but starting/
 * submitting requires an authenticated user (`uid`) and must still respect
 * the live window and attempt limits.
 *
 * @param examId - Exam id (e.g. "hsc-26-model-01")
 * @param uid - Firebase uid of the student when checking ability to *start*
 *              the exam. Omit / undefined for a pure "can view?" probe —
 *              the service still enforces published/live/enrolled-kind checks
 *              and reports that sign-in is required to start.
 */
export async function checkPublicExamAccess(
  examId: string,
  uid?: string,
): Promise<{ allowed: boolean; reason?: string; error?: boolean }> {
  const normalizedId = examId?.trim();
  if (!normalizedId) {
    return { allowed: false, reason: "Invalid exam id." };
  }

  // Reuse the common engine as the single source of truth for exam rows.
  // Fail CLOSED: any DB/infra error denies access (never allowed:true).
  let exams;
  try {
    exams = await fetchExams();
  } catch {
    return {
      allowed: false,
      reason: "Could not verify exam access. Please retry.",
      error: true,
    };
  }
  const exam = exams.find((e) => e.id === normalizedId);

  if (!exam) {
    return { allowed: false, reason: "Exam not found." };
  }

  // Public path must never serve enrolled-kind exams (gated by course enrollment).
  if (exam.kind === "enrolled") {
    return {
      allowed: false,
      reason: "This exam is only available through your enrolled courses.",
    };
  }

  // Must be published.
  if (exam.status !== "published") {
    const reason =
      exam.status === "closed"
        ? "This exam is closed."
        : "This exam is not published yet.";
    return { allowed: false, reason };
  }

  // Practice exams are always available while published (never time-gated).
  if (exam.examMode === "practice") {
    // Fall through to auth + attempt checks below.
  } else {
    // Public Live: Upcoming → Live → Practice Exam (automatic after End
    // Time; still startable, attempts unranked). Admin-closed exams stay
    // Closed → Hidden, server-time based. Fail CLOSED on lifecycle errors.
    let state;
    try {
      const { getPublicLiveState } = await import("@/lib/exam-lifecycle");
      state = getPublicLiveState(exam);
    } catch {
      return {
        allowed: false,
        reason: "Could not verify exam window. Please retry.",
        error: true,
      };
    }
    if (state === "draft" || state === "upcoming") {
      return { allowed: false, reason: "This exam has not started yet." };
    }
    if (state === "closed" || state === "hidden") {
      return { allowed: false, reason: "This exam has ended." };
    }
    // Fallback to the canonical display status for legacy rows without a window.
    const status = deriveStatus(exam);
    if (status !== "Live" && status !== "Practice" && status !== "Available") {
      if (status === "Upcoming") {
        return { allowed: false, reason: "This exam has not started yet." };
      }
      return { allowed: false, reason: "This exam has ended." };
    }
  }

  // Public exams are viewable without sign-in, but starting an attempt
  // requires authentication. When uid is absent the caller is probing
  // view/start eligibility — report that sign-in is required to start.
  if (!uid || !uid.trim()) {
    return {
      allowed: false,
      reason:
        "You must be signed in to start this exam. Anyone can view the exam details.",
    };
  }

  // Strict One Attempt Per Public LIVE Exam only. Public Practice exams are
  // retakable per attempt rules (dynamic merit) — skip the one-attempt block.
  // Post-live Practice phase (live window ended) is likewise retakable:
  // every attempt there is an unranked practice attempt.
  let skipOneAttempt = exam.examMode === "practice";
  if (!skipOneAttempt) {
    try {
      const { isPublicPostLivePractice } = await import("@/lib/exam-lifecycle");
      skipOneAttempt = isPublicPostLivePractice(exam);
    } catch {
      skipOneAttempt = false;
    }
  }
  if (!skipOneAttempt) {
    try {
      const countRows = await query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
        [normalizedId, uid.trim()],
      );
      if ((countRows[0]?.n ?? 0) > 0) {
        return {
          allowed: false,
          reason: "You have already appeared in this exam. View your result.",
        };
      }
    } catch {
      return {
        allowed: false,
        reason: "Could not verify previous attempts. Please retry.",
        error: true,
      };
    }
  }

  // Attempt limits (shared with the engine's startExamAttempt guard) — fallback for enrolled / legacy.
  // Fail CLOSED: DB errors deny rather than allow an extra attempt.
  try {
    const settingsRows = await query<
      { max_attempts: number | string | null }[]
    >(`SELECT max_attempts FROM exam_settings WHERE id = 'active' LIMIT 1`);
    const raw = settingsRows[0]?.max_attempts;
    const maxAttempts =
      raw !== null && raw !== undefined ? Number(raw) : null;
    if (
      maxAttempts !== null &&
      Number.isFinite(maxAttempts) &&
      maxAttempts > 0
    ) {
      const countRows = await query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
        [normalizedId, uid.trim()],
      );
      if ((countRows[0]?.n ?? 0) >= maxAttempts) {
        return {
          allowed: false,
          reason: `Maximum attempts (${maxAttempts}) reached for this exam.`,
        };
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Maximum attempts")
    ) {
      throw error;
    }
    return {
      allowed: false,
      reason: "Could not verify attempt limit. Please retry.",
      error: true,
    };
  }

  return { allowed: true };
}
