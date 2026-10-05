import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { getExamResultScript } from "@/lib/exam-taking";
import { parseExamVersion } from "@/lib/exam-result-language";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id]/result — the student's answer script for their most
 * recent submitted attempt (chosen + correct answers). Only exists AFTER a
 * submission; during an active exam there is nothing to reveal.
 * Optional exam_version=en|bn is a legacy fallback; the stored medium wins.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const versions = request.nextUrl.searchParams.getAll("exam_version");
  const requestedVersion = parseExamVersion(versions[0]);
  if (versions.length > 1 || (versions.length === 1 && !requestedVersion)) {
    return NextResponse.json(
      { error: "Invalid exam_version. Must be 'en' or 'bn'." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const script = await getExamResultScript(id, user.uid, requestedVersion);
  if (!script) {
    return NextResponse.json(
      { error: "No submitted result found for this exam yet." },
      { status: 404 },
    );
  }

  return NextResponse.json(script, {
    headers: { "Cache-Control": "no-store" },
  });
}
