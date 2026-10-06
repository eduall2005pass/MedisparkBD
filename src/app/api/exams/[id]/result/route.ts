import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { requireAnyPermission } from "@/lib/admin";
import { getExamResultScript } from "@/lib/exam-taking";
import { parseExamVersion } from "@/lib/exam-result-language";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id]/result — ADMIN ONLY. The student's answer script for
 * their most recent submitted attempt. Public/student access is disabled;
 * results are viewed from the Admin Panel (Result Control).
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
  const admin = await requireAnyPermission(request, ["manageResults", "manageExams"]);
  if (!admin) {
    return NextResponse.json({ error: "Administrators only." }, { status: 403 });
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
