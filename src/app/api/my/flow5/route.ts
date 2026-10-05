import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { isMysqlConfigured } from "@/lib/mysql";
import { hasFreshActiveEnrollment } from "@/lib/enrolled-exams-server";
import {
  getFlow5Counts,
  getFlow5Exams,
  isFlow5Format,
  isFlow5SubjectKey,
  type Flow5Format,
  type Flow5SubjectKey,
} from "@/lib/flow5";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// Student Flow 5 (Exam Flow) read — enrollment-gated.
// Only students with an ACTIVE enrollment in the course may access, and only
// exams linked to THAT course are returned (verified in SQL via exam_courses
// or the chapter → subject → course chain). Exam taking itself reuses the
// existing engine (/exam/[id]/rules) unchanged.
//
// GET ?course=slug
//   → { counts: { formats, subjects } } for the 4 exam cards (+ subject badges)
// GET ?course=slug&format=topic-wise|paper-final|subject-final|final-model
//   → { exams: [...] } — ONE category only, never mixed.
//   Topic-wise additionally accepts &subject=<one of the 8 keys> to list only
//   that subject's exams. Paper/Subject/Final-model NEVER take a subject.
export async function GET(request: NextRequest) {
  try {
    const user = await getFirebaseUser(request);
    if (!user || !isMysqlConfigured) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    const slug = request.nextUrl.searchParams.get("course") ?? "";
    if (!slug) return NextResponse.json({ error: "Missing course." }, { status: 400, headers });
    const enrolled = await hasFreshActiveEnrollment(user.uid, slug);
    if (!enrolled) return NextResponse.json({ error: "Not enrolled." }, { status: 403, headers });
    const formatParam = request.nextUrl.searchParams.get("format") ?? "";
    if (!formatParam) {
      const counts = await getFlow5Counts(slug);
      return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!isFlow5Format(formatParam)) {
      return NextResponse.json({ error: "Invalid exam category." }, { status: 400, headers });
    }
    const format: Flow5Format = formatParam;
    let subject: Flow5SubjectKey | null = null;
    if (format === "topic-wise") {
      const subjectParam = request.nextUrl.searchParams.get("subject") ?? "";
      // No subject → still scoped to topic-wise only (counts per subject
      // included so the UI can render the 8 subject cards with badges).
      if (subjectParam) {
        if (!isFlow5SubjectKey(subjectParam)) {
          return NextResponse.json({ error: "Invalid subject." }, { status: 400, headers });
        }
        subject = subjectParam;
      }
      const [exams, counts] = await Promise.all([
        getFlow5Exams(slug, format, subject),
        getFlow5Counts(slug),
      ]);
      return NextResponse.json({ exams, counts }, { headers: { "Cache-Control": "no-store" } });
    }
    // Paper Final / Subject Final / Final Model: direct exam list, no subject.
    const exams = await getFlow5Exams(slug, format, null);
    return NextResponse.json({ exams }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Failed to load exams." }, { status: 500, headers });
  }
}
