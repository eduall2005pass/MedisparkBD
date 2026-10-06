import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { requireAnyPermission } from "@/lib/admin";
import {
  getStudentResultCards,
  type ResultCardKind,
} from "@/lib/my-exam-results";

export const dynamic = "force-dynamic";

/**
 * GET /api/my/exam-results/cards?kind=public|course — ADMIN ONLY.
 * Student result cards are viewed from the Admin Panel (Result Control).
 */
export async function GET(request: NextRequest) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const admin = await requireAnyPermission(request, ["manageResults", "manageExams"]);
  if (!admin) {
    return NextResponse.json({ error: "Administrators only." }, { status: 403 });
  }
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: ResultCardKind = kindParam === "course" ? "course" : "public";
  const results = await getStudentResultCards(user.uid, kind);
  return NextResponse.json(
    { kind, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
