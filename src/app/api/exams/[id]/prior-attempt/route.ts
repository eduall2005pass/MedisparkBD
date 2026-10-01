import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { hasPriorExamAttempt } from "@/lib/exam-taking";
import { fetchExamPageById } from "@/lib/public-exams-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id]/prior-attempt — returns whether the student has a
 * prior submitted result for this exam, plus exam metadata needed for the
 * Timer Selection page.
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
  const exam = await fetchExamPageById(id);
  if (!exam) {
    return NextResponse.json({ error: "Exam not found." }, { status: 404 });
  }

  const hasPrior = await hasPriorExamAttempt(id, user.uid);

  // Practice retake allowed? (mirrors startExamAttempt exemptions)
  // Post-live / enrolled-archived / static-practice exams may be retaken
  // unlimited times as unranked practice — the rules gate must offer that
  // path instead of a dead-end "already appeared" wall.
  let canPracticeRetake = false;
  try {
    const { fetchExamById } = await import("@/lib/exams-admin");
    const adminExam = await fetchExamById(id);
    if (adminExam) {
      if (adminExam.kind === "enrolled") {
        const { getEnrolledExamPhase, isEnrolledPracticePhase } = await import(
          "@/lib/enrolled-exam-lifecycle"
        );
        canPracticeRetake = isEnrolledPracticePhase(getEnrolledExamPhase(adminExam));
      } else {
        const { isPublicPracticeExam, isPublicPostLivePractice } = await import(
          "@/lib/exam-lifecycle"
        );
        canPracticeRetake =
          isPublicPracticeExam(adminExam) || isPublicPostLivePractice(adminExam);
      }
    }
  } catch {
    // Best-effort — default stays false (strict one-attempt wall).
  }

  return NextResponse.json({
    exam: {
      id: exam.id,
      name: exam.name,
      description: exam.description,
      bannerUrl: exam.bannerUrl,
      batch: exam.batch,
      courseType: exam.courseType,
      subject: exam.subject,
      totalMarks: exam.totalMarks,
      totalQuestions: exam.totalQuestions,
      durationMinutes: exam.durationMinutes,
      negativeMarks: exam.negativeMarks,
      negativeEnabled: exam.negativeEnabled,
      negativePerWrong: exam.negativePerWrong,
      scheduledAt: exam.scheduledAt,
      endsAt: exam.endsAt,
      examDate: exam.examDate,
      examTime: exam.examTime,
      status: exam.status,
      published: exam.published,
      secondTimerEnabled: exam.secondTimerEnabled,
      secondTimerDeduction: exam.secondTimerDeduction,
    },
    hasPriorAttempt: hasPrior,
    canPracticeRetake,
  });
}
