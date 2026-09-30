import { fetchExams, hasEnrolledExamAccess } from "@/lib/exams-admin";
import { hasPriorExamAttempt } from "@/lib/exam-taking";
import { query } from "@/lib/mysql";

/**
 * True when the student has a prior SCHEDULED (live) result for this exam.
 * Practice attempts never count — they must not block Live entry or
 * archived-phase practice retakes. On legacy DBs without the attempt_type
 * column, every row is scheduled-equivalent, so fall back to any-result.
 */
async function hasScheduledExamAttempt(
  examId: string,
  uid: string,
): Promise<boolean> {
  try {
    const rows = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ? AND (attempt_type = 'scheduled' OR attempt_type IS NULL)`,
      [examId, uid],
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return hasPriorExamAttempt(examId, uid);
  }
}

/**
 * Course (enrolled) exam access — thin wrapper over the shared exam engine.
 *
 * MASTER PROMPT §50 — "DO NOT build separate exam engines" rule:
 * There is a SINGLE engine (`getExamForTaking` / `fetchExams` +
 * `hasEnrolledExamAccess`) and TWO distinct access services that guard it.
 * This file is the COURSE-ENROLLED path. It reuses `fetchExams` as the
 * single source of truth for exam rows and `hasEnrolledExamAccess` for the
 * canonical course-enrollment check (exam_courses JOIN enrollments).
 *
 * Distinct validation path from `checkPublicExamAccess`:
 *  - requires authentication (uid is mandatory)
 *  - requires active/completed enrollment in at least one assigned course
 *  - then enforces the same published/live and attempt-limit guards
 *
 * ALL enrolled (private/course) exams follow the lifecycle:
 *   UPCOMING → LIVE → PRACTICE
 * after endsAt, the exam is still accessible as Practice for enrolled students.
 *
 * @param examId - Exam id (e.g. "enrolled-physics-ch01-01")
 * @param uid - Firebase uid of the student (required for enrolled exams)
 */
export async function checkCourseExamAccess(
  examId: string,
  uid: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const normalizedId = examId?.trim();
  if (!normalizedId) {
    return { allowed: false, reason: "Invalid exam id." };
  }

  // Authenticated check — enrolled exams cannot be viewed or started anonymously.
  if (!uid || !uid.trim()) {
    return { allowed: false, reason: "You must be signed in to access this exam." };
  }
  const cleanUid = uid.trim();

  // Reuse the common engine as the single source of truth for exam rows.
  const exams = await fetchExams();
  const exam = exams.find((e) => e.id === normalizedId);

  if (!exam) {
    return { allowed: false, reason: "Exam not found." };
  }

  // Although this service is intended for enrolled-kind exams, it still
  // defensively handles any kind by applying the same published/live gates.
  if (exam.status !== "published") {
    const reason =
      exam.status === "closed"
        ? "This exam is closed."
        : "This exam is not published yet.";
    return { allowed: false, reason };
  }

  // ── Enrolled (Course) Exam Lifecycle ────────────────────────────────
  // Draft → Upcoming → Live → Archived (practice).
  // Archived allows Practice Again (practice attempts never affect official merit/ranking).
  const { getEnrolledExamPhase, isEnrolledExam, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
  const enrolled = await isEnrolledExam(normalizedId);
  let enrolledPractice = false;

  if (enrolled) {
    const phase = getEnrolledExamPhase(exam);
    if (phase === "draft") {
      return { allowed: false, reason: "This exam is not published yet." };
    }
    if (phase === "closed") {
      return { allowed: false, reason: "This exam is closed." };
    }
    if (phase === "upcoming") {
      return { allowed: false, reason: "This exam has not started yet." };
    }
    if (phase === "no-window") {
      // No schedule set — treat as always Live (legacy) — fall through.
    }
    // Archived (post-live Practice): still startable as practice — practice
    // attempts are completable but never ranked. Fall through to gates below.
    enrolledPractice = isEnrolledPracticePhase(phase);
  }

  // Course-enrollment gate — delegates to the shared helper which checks
  // exam_courses JOIN enrollments (active/completed). This is the single
  // definition of "enrolled" used by getExamForTaking and /api/exams/mine.
  const isEnrolled = await hasEnrolledExamAccess(normalizedId, cleanUid);
  if (!isEnrolled) {
    return {
      allowed: false,
      reason: "You are not enrolled in the course for this exam.",
    };
  }

  // One-attempt rule for course exams: only a prior SCHEDULED (live)
  // result blocks re-entry. Practice attempts never block — archived exams
  // stay startable as practice (LIVE → PRACTICE promise).
  // In the practice phase the check is skipped entirely (retakes allowed).
  if (!enrolledPractice) {
    try {
      const hasPrior = await hasScheduledExamAttempt(
        normalizedId,
        cleanUid,
      );
      if (hasPrior) {
        return {
          allowed: false,
          reason: "You have already appeared in this exam. View your result.",
        };
      }
    } catch {
      // Fail open for DB errors — other guards remain enforced.
    }
  }

  // Attempt limits — same guard as the engine's startExamAttempt.
  // Practice phase is exempt (mirrors the engine bypass): enrolled students
  // may retake for practice even when maxAttempts would otherwise block.
  // Otherwise count only scheduled attempts so a prior practice never
  // blocks a Live entry — consistent with the engine's scheduled-only merit.
  if (enrolledPractice) {
    return { allowed: true };
  }
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
      // For enrolled exams, count only scheduled attempts so a prior
      // practice does not block a Live entry.
      let count = 0;
      try {
        const liveRows = await query<{ n: number }[]>(
          `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ? AND (attempt_type = 'scheduled' OR attempt_type IS NULL)`,
          [normalizedId, cleanUid],
        );
        count = liveRows[0]?.n ?? 0;
      } catch {
        const fallback = await query<{ n: number }[]>(
          `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
          [normalizedId, cleanUid],
        );
        count = fallback[0]?.n ?? 0;
      }
      if (count >= maxAttempts) {
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
    // Fail open for attempt-limit DB errors — enrollment/published/live
    // checks above remain enforced.
  }

  return { allowed: true };
}
