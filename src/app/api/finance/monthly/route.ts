import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { fetchMonthlyReport } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/monthly?year=2026
 * Permission-gated. Month | Course Income | Physical Costs | Net.
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
  const raw = Number(url.searchParams.get("year"));
  const year =
    Number.isInteger(raw) && raw >= 2000 && raw <= 2100
      ? raw
      : new Date().getFullYear();
  const months = await fetchMonthlyReport(year);
  const totals = months.reduce(
    (s, m) => ({
      courseIncome: s.courseIncome + m.courseIncome,
      physicalCosts: s.physicalCosts + m.physicalCosts,
      net: s.net + m.net,
    }),
    { courseIncome: 0, physicalCosts: 0, net: 0 },
  );
  return NextResponse.json({ year, months, totals });
}
