import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { requireAnyPermission } from "@/lib/admin";
import { getStudentExamResultDetail } from "@/lib/my-exam-results";

export const dynamic = "force-dynamic";

/**
 * GET — ADMIN ONLY. One exam's detailed result (Admin Panel only).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = await requireAnyPermission(request, ["manageResults", "manageExams"]);
  if (!admin) {
    return NextResponse.json({ error: "Administrators only." }, { status: 403 });
  }
  const { examId } = await context.params;
  const detail = await getStudentExamResultDetail(
    user.uid,
    decodeURIComponent(examId),
  );
  if (!detail) {
    return NextResponse.json(
      { error: "Result not found for this exam." },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { result: detail },
    { headers: { "Cache-Control": "no-store" } },
  );
}
