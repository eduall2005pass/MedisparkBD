import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { fetchManualCosts, normalizeRange } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/export?format=csv&from&to&category&status&search
 * Permission-gated. Exports respect the selected filters/date range.
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
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv") {
    return NextResponse.json(
      { error: "Unsupported format. Use format=csv." },
      { status: 400 },
    );
  }
  const { from, to } = normalizeRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const { costs } = await fetchManualCosts({
    from,
    to,
    category: url.searchParams.get("category"),
    status: url.searchParams.get("status"),
    paidBy: url.searchParams.get("paidBy"),
    search: url.searchParams.get("search"),
    limit: 500,
    offset: 0,
  });
  const escape = (v: unknown): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Date",
    "Category",
    "Item",
    "Description",
    "Amount (BDT)",
    "Paid By",
    "Payment Method",
    "Status",
  ];
  const lines = costs.map((c) =>
    [
      c.costDate,
      c.category,
      c.itemName,
      c.description ?? "",
      String(c.amount),
      c.paidBy,
      c.paymentMethod,
      c.status,
    ]
      .map(escape)
      .join(","),
  );
  const csv = `\uFEFF${header.join(",")}\n${lines.join("\n")}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="medispark-costs-${from ?? "all"}-${to ?? "all"}.csv"`,
    },
  });
}
