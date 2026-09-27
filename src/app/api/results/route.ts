import { NextRequest, NextResponse } from "next/server";
import { fetchAllResults, fetchResultExams } from "@/lib/all-results";

export const dynamic = "force-dynamic";

/**
 * Public result board — NO auth. Privacy-safe rows only
 * (name + student ID + college; never email/phone/UID).
 * GET → { results, total, page, limit }
 * GET ?exams=1 → { exams } (filter dropdown)
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    if (sp.get("exams") === "1") {
      return NextResponse.json(
        { exams: await fetchResultExams() },
        { headers: { "Cache-Control": "public, max-age=60" } },
      );
    }
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));
    const { rows, total } = await fetchAllResults({
      examId: sp.get("examId") ?? "",
      q: sp.get("q") ?? "",
      page,
      limit,
    });
    return NextResponse.json(
      { results: rows, total, page, limit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong." },
      { status: 500 },
    );
  }
}
