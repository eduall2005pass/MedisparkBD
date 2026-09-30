import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import {
  fetchIncomeTotals,
  fetchCostTotals,
  fetchCategoryBreakdown,
  fetchAdminSpending,
  normalizeRange,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Permission-gated. No PII: only aggregated totals.
 *   courseIncome (automated) - physicalCosts (manual) = netBalance
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
  const range = { from, to };
  const [income, costs, categories, admins] = await Promise.all([
    fetchIncomeTotals(range),
    fetchCostTotals(range),
    fetchCategoryBreakdown(range),
    fetchAdminSpending(range),
  ]);
  return NextResponse.json({
    from,
    to,
    courseIncome: income,
    physicalCosts: costs,
    netBalance: income.net - costs.total,
    thisMonthHint: "Use from/to = first/last day of month for monthly cards.",
    categories,
    adminSpending: admins.map((a) => ({
      paidBy: a.paidBy,
      transactions: a.transactions,
      total: a.total,
      percentage: a.percentage,
    })),
    lastUpdated: new Date().toISOString(),
  });
}
