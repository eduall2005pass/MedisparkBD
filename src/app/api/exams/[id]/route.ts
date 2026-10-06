import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { getExamForTaking } from "@/lib/exam-taking";
import { fetchExamPageById } from "@/lib/public-exams-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id] — exam meta + sanitized questions (no answers).
 *
 * Server-side access validation:
 * 1. Authentication required
 * 2. Exam must exist and be published
 * 3. Exam must be active (Live or Available status)
 * 4. Current time must be within the allowed exam window
 * 5. Attempt limit is enforced by the Common Exam Engine
 * 6. Enrolled exams require course enrollment (checked by getExamForTaking)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await context.params;

  // Automatic "Exam Is Live Now" sweep (Notification Control → Enrolled
  // Students). Fires at most once per (exam, course) via the event ledger —
  // viewing an exam can never resend. Fully non-blocking: never delays the exam.
  void import("@/lib/notification-events")
    .then((events) => events.sweepLiveCourseExams().catch(() => undefined))
    .catch(() => undefined);

  // The attempt (timer + answer storage) begins only with ?start=1 — i.e.
  // after the student accepts the exam rules on the client.
  const startAttempt = request.nextUrl.searchParams.get("start") === "1";
  const timerType = request.nextUrl.searchParams.get("timer") ?? "first";
  // Question Version chosen on the Rules page (bangla/english). Locked after start.
  const questionVersion = request.nextUrl.searchParams.get("version") ?? "bangla";

  // Server-side access validation before creating an attempt.
  if (startAttempt) {
    const examMeta = await fetchExamPageById(id);
    if (!examMeta) {
      return NextResponse.json(
        { error: "Exam not found." },
        { status: 404 },
      );
    }

    // Exam must be published and active.
    if (!examMeta.published) {
      return NextResponse.json(
        { error: "This exam is not published yet." },
        { status: 403 },
      );
    }

    if (examMeta.status === "Inactive" || examMeta.status === "Unpublished") {
      return NextResponse.json(
        { error: "This exam is not active." },
        { status: 403 },
      );
    }

    // Lifecycle gates (server time): Public Live Upcoming blocks start;
    // post-live Practice phase allows start (attempts recorded as unranked
    // practice); admin-closed/hidden still block. Public Practice always
    // startable; Course Upcoming blocks, Archived allows Practice Again.
    let isEnrolled = false;
    try {
      const { isEnrolledExam } = await import("@/lib/enrolled-exam-lifecycle");
      isEnrolled = await isEnrolledExam(id);
    } catch {
      isEnrolled = false;
    }
    if (isEnrolled) {
      try {
        const { getEnrolledExamPhase, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
        const { fetchExamById } = await import("@/lib/exams-admin");
        const raw = await fetchExamById(id);
        if (raw) {
          const phase = getEnrolledExamPhase(raw);
          if (phase === "upcoming") {
            return NextResponse.json(
              { error: "This exam has not started yet." },
              { status: 403 },
            );
          }
          // Live and Archived(practice) both allow start.
          void isEnrolledPracticePhase;
        }
      } catch {
        // Fallback to original check if lookup fails
        if (examMeta.status === "Completed" || examMeta.status === "Expired") {
          return NextResponse.json(
            { error: "This exam has ended. You can no longer start it." },
            { status: 403 },
          );
        }
      }
    } else {
      // Public: Practice (static or post-live) always startable; Live follows
      // Upcoming → Live → Practice Exam. Only admin-closed/hidden block start.
      if (examMeta.examMode === "practice") {
        // Always allow start while published — no time gate.
      } else {
        try {
          const { getPublicLiveState } = await import("@/lib/exam-lifecycle");
          const { fetchExamById } = await import("@/lib/exams-admin");
          const raw = await fetchExamById(id);
          if (raw) {
            const state = getPublicLiveState(raw);
            if (state === "upcoming" || state === "draft") {
              return NextResponse.json(
                { error: "This exam has not started yet." },
                { status: 403 },
              );
            }
            if (state === "closed" || state === "hidden") {
              return NextResponse.json(
                { error: "This exam has ended. You can no longer start it." },
                { status: 403 },
              );
            }
          } else if (examMeta.status === "Completed" || examMeta.status === "Expired") {
            return NextResponse.json(
              { error: "This exam has ended. You can no longer start it." },
              { status: 403 },
            );
          }
        } catch {
          if (examMeta.status === "Completed" || examMeta.status === "Expired") {
            return NextResponse.json(
              { error: "This exam has ended. You can no longer start it." },
              { status: 403 },
            );
          }
        }
      }
    }

    // Timer type validation — must be "first" or "second".
    if (timerType !== "first" && timerType !== "second") {
      return NextResponse.json(
        { error: "Invalid timer type. Must be 'first' or 'second'." },
        { status: 400 },
      );
    }

    // Question Version validation — normalized server-side on start;
    // unknown values fall back to Bangla (legacy links without ?version=).
    const { normalizeVersion: normalizeStartVersion } = await import("@/lib/exam-variants");
    if (!normalizeStartVersion(questionVersion)) {
      return NextResponse.json(
        { error: "Invalid question version. Must be 'bangla' or 'english'." },
        { status: 400 },
      );
    }
  }

  let payload: Awaited<ReturnType<typeof getExamForTaking>> = null;
  try {
    const { normalizeVersion } = await import("@/lib/exam-variants");
    payload = await getExamForTaking(
      id,
      user.uid,
      user.name || user.email || "Student",
      startAttempt,
      timerType as "first" | "second",
      normalizeVersion(questionVersion) ?? "bangla",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start exam.";
    if (message.includes("already appeared")) {
      // For public exams with strict one-attempt, return 403 with existing result hint
      // Frontend will show View Result instead of Start Exam
      try {
        const { query } = await import("@/lib/mysql");
        // Try to fetch existing result for View Result link.
        // Scheduled scope only — practice attempts don't count as appeared.
        let rows: { id: number }[];
        try {
          rows = await query<{ id: number }[]>(
            `SELECT id FROM exam_results WHERE exam_id = ? AND student_uid = ? AND (attempt_type IN ('scheduled', 'live') OR attempt_type IS NULL) LIMIT 1`,
            [id, user.uid],
          );
        } catch {
          rows = await query<{ id: number }[]>(
            `SELECT id FROM exam_results WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
            [id, user.uid],
          );
        }
        if (rows[0]) {
          return NextResponse.json(
            { error: message, alreadyAttempted: true, examId: id },
            { status: 403 },
          );
        }
      } catch {
        // fall through
      }
      return NextResponse.json(
        { error: message, alreadyAttempted: true, examId: id },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!payload) {
    // Distinguish missing ID vs genuinely unavailable (draft/closed/enrolled)
    // to avoid showing "No exam found" due to category/status mismatches.
    const { fetchExamById } = await import("@/lib/exams-admin");
    const direct = await fetchExamById(id);
    if (!direct) {
      return NextResponse.json({ error: "Exam not found." }, { status: 404 });
    }
    if (direct.status === "draft") {
      return NextResponse.json({ error: "This exam is not published yet." }, { status: 403 });
    }
    if (direct.kind === "enrolled") {
      return NextResponse.json({ error: "You are not enrolled for this exam." }, { status: 403 });
    }
    // Published but otherwise unavailable (e.g. no questions, or not Live)
    return NextResponse.json(
      { error: "Exam not found or not available." },
      { status: 404 },
    );
  }

  // Preview gate: without ?start=1 (rules acceptance / timer start),
  // question content is served only to a gated student — active attempt
  // (resume) or prior scheduled submission. Otherwise return meta only so
  // the full previewResolved set never leaks pre-start.
  if (!startAttempt && payload && payload.questions.length > 0) {
    let gated = false;
    try {
      const { query } = await import("@/lib/mysql");
      try {
        const activeRows = await query<{ n: string | number }[]>(
          `SELECT COUNT(*) AS n FROM exam_attempts WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
          [id, user.uid],
        );
        gated = Number(activeRows[0]?.n ?? 0) > 0;
      } catch {
        gated = false;
      }
      if (!gated) {
        try {
          const priorRows = await query<{ n: string | number }[]>(
            `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ? AND (attempt_type IN ('scheduled', 'live') OR attempt_type IS NULL)`,
            [id, user.uid],
          );
          gated = Number(priorRows[0]?.n ?? 0) > 0;
        } catch {
          try {
            const priorRows = await query<{ n: string | number }[]>(
              `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
              [id, user.uid],
            );
            gated = Number(priorRows[0]?.n ?? 0) > 0;
          } catch {
            gated = false;
          }
        }
      }
    } catch {
      gated = false;
    }
    if (!gated) {
      payload.questions = [];
      payload.storedAnswers = {};
      payload.questionVersion = null;
    }
  }

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
