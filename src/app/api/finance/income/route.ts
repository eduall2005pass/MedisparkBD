import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { fetchCourseIncome, normalizeRange } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/income?from&to&course&search
 * Permission-gated, READ-ONLY. Aggregated from existing `enrollments` data.
 * No student PII is exposed (course-level rows only).
 */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, [
    "manageSystem",
    "manageCourses",
  ]);
  if (!admin) {
    const user = await getFirebaseUser(request);
    return NextResponse.json(
      { error: user ? "Forbidden." : "Unauthorized." },
      { status: user ? 403 : 401 },
    );
  }
  const url = new URL(request.url);
  const { from, to } = normalizeRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const rows = await fetchCourseIncome({
    from,
    to,
    course: url.searchParams.get("course"),
    search: url.searchParams.get("search"),
  });
  const totals = rows.reduce(
    (s, r) => ({
      orders: s.orders + r.orders,
      gross: s.gross + r.gross,
      refund: s.refund + r.refund,
      net: s.net + r.net,
    }),
    { orders: 0, gross: 0, refund: 0, net: 0 },
  );
  return NextResponse.json({ from, to, rows, totals, readonly: true });
}
