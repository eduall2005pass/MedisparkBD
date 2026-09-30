import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { logAdminAction } from "@/lib/administration";
import {
  createManualCost,
  fetchManualCosts,
  normalizeRange,
  validateCostInput,
} from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/costs — permission-gated. Full records +
 *   search/filter/sort/pagination, incl. pending/cancelled.
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
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    Math.max(Number(url.searchParams.get("pageSize")) || 50, 1),
    200,
  );
  const search = url.searchParams.get("search");
  const category = url.searchParams.get("category");
  const paidBy = url.searchParams.get("paidBy");

  // ── Permission-gated: full records ──
  const status = url.searchParams.get("status");
  const includeDeleted = url.searchParams.get("includeDeleted") === "1";
  const { costs, total } = await fetchManualCosts({
    from,
    to,
    category,
    status,
    paidBy,
    search,
    includeDeleted,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return NextResponse.json({ costs, total, page, pageSize, isAdmin: true });
}

/**
 * POST /api/finance/costs — permission-gated.
 * Body is strictly whitelisted; created_by comes from the verified token,
 * never from the client (mass-assignment safe).
 */
export async function POST(request: NextRequest) {
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
  const body = await request.json().catch(() => null);
  const parsed = validateCostInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const created = await createManualCost(parsed.value, {
      uid: admin.uid,
      email: admin.email ?? null,
    });
    await logAdminAction(
      { uid: admin.uid, email: admin.email },
      "finance.create",
      `#${created.id} ${created.itemName} ৳${created.amount}`,
      request,
    );
    return NextResponse.json({ cost: created }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create the cost record." },
      { status: 500 },
    );
  }
}
