import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { saveExamAnswer } from "@/lib/exam-taking";
import { query } from "@/lib/mysql";

export const dynamic = "force-dynamic";

type AnswerBody = {
  token?: unknown;
  questionId?: unknown;
  optionIndex?: unknown;
};

/**
 * POST /api/exams/[id]/answer — store a single selection.
 * Server-enforced: the first selection for a question wins; changes are
 * rejected. Expiry (now >= expires_at) auto-submits; silence/offline never
 * does. Multi-tab resume shares the attempt — token mismatch no longer kills
 * a live session.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as AnswerBody | null;
  // IDs may arrive as strings ("123") or numbers (123) depending on the
  // client/serialization — coerce both. optionIndex must be a non-negative
  // integer; anything else is rejected (never defaulted to 0/"A").
  const questionId =
    typeof body?.questionId === "number"
      ? body.questionId
      : typeof body?.questionId === "string" && body.questionId.trim() !== ""
        ? Number(body.questionId)
        : NaN;
  const optionIndex =
    typeof body?.optionIndex === "number"
      ? body.optionIndex
      : typeof body?.optionIndex === "string" && body.optionIndex.trim() !== ""
        ? Number(body.optionIndex)
        : NaN;
  if (
    !body ||
    typeof body.token !== "string" ||
    !body.token ||
    !Number.isInteger(questionId) ||
    questionId <= 0 ||
    !Number.isInteger(optionIndex) ||
    optionIndex < 0
  ) {
    return NextResponse.json(
      { error: "Missing answer details." },
      { status: 400 },
    );
  }

  const { id } = await context.params;

  // Re-check the LIVE window/closed/published state on every answer so
  // stale clients are rejected after close (saveExamAnswer alone only
  // checks question membership). Fail CLOSED on DB errors.
  try {
    const examRows = await query<
      {
        status: string;
        kind: string;
        exam_mode: string;
        scheduled_at: Date | string | null;
        ends_at: Date | string | null;
      }[]
    >(
      `SELECT status, kind, exam_mode, scheduled_at, ends_at FROM exams WHERE id = ? LIMIT 1`,
      [id],
    );
    const examRow = examRows[0];
    if (!examRow) {
      return NextResponse.json({ error: "Exam not found." }, { status: 404 });
    }

    if (examRow.status !== "published") {
      return NextResponse.json(
        {
          error:
            examRow.status === "closed"
              ? "This exam has ended."
              : "This exam is not available.",
        },
        { status: 409 },
      );
    }
    if (examRow.exam_mode !== "practice") {
      const { getPublicLiveState } = await import("@/lib/exam-lifecycle");
      const state = getPublicLiveState({
        kind: examRow.kind === "enrolled" ? "enrolled" : "public",
        status: examRow.status,
        examMode: examRow.exam_mode === "practice" ? "practice" : "live",
        scheduledAt: examRow.scheduled_at
          ? new Date(examRow.scheduled_at).toISOString()
          : null,
        endsAt: examRow.ends_at
          ? new Date(examRow.ends_at).toISOString()
          : null,
      });
      if (state === "draft" || state === "upcoming") {
        return NextResponse.json(
          { error: "This exam has not started yet." },
          { status: 409 },
        );
      }
      if (state === "closed" || state === "hidden") {
        return NextResponse.json(
          { error: "This exam has ended." },
          { status: 409 },
        );
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Could not verify exam window. Please retry.", transient: true },
      { status: 503 },
    );
  }

  // Validate question belongs to this exam (free-order: any question may be
  // answered at any time, any skip/jump is allowed).
  try {
    const questionRows = await query<{ id: number | string }[]>(
      `SELECT id FROM exam_questions WHERE exam_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
      [id],
    );
    const orderedIds = questionRows.map((r) => Number(r.id));
    if (!orderedIds.includes(questionId)) {
      return NextResponse.json(
        { error: "Invalid question for this exam." },
        { status: 400 },
      );
    }
  } catch {
    // Fail CLOSED: cannot verify question membership — reject, do not accept.
    return NextResponse.json(
      { error: "Could not verify question. Please retry.", transient: true },
      { status: 503 },
    );
  }

  const result = await saveExamAnswer(
    id,
    user.uid,
    user.name || user.email || "Student",
    body.token,
    questionId,
    optionIndex,
  );
  if (result.autoSubmitted && result.outcome) {
    return NextResponse.json(result);
  }
  if (!result.accepted && !result.terminated) {
    return NextResponse.json(
      { error: "This answer is locked — you can select an answer only once." },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}
