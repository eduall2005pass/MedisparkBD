import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import {
  getStudentResultCards,
  type ResultCardKind,
} from "@/lib/my-exam-results";

export const dynamic = "force-dynamic";

/**
 * GET /api/my/exam-results/cards?kind=public|course — the logged-in
 * student's simplified result cards for ONE exam kind only. Public returns
 * kind <> 'enrolled' attempts; course returns kind = 'enrolled' attempts.
 * The two kinds are never mixed.
 */
export async function GET(request: NextRequest) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind: ResultCardKind = kindParam === "course" ? "course" : "public";
  const results = await getStudentResultCards(user.uid, kind);
  return NextResponse.json(
    { kind, results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
