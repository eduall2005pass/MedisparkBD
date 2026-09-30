import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { fetchFinanceAudit } from "@/lib/finance";

export const dynamic = "force-dynamic";

/** GET /api/finance/audit — permission-gated. Full modification trail. */
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
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 200, 1),
    500,
  );
  const entries = await fetchFinanceAudit(limit);
  return NextResponse.json({ entries });
}
