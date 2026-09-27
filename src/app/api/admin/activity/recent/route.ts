import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { ALL_PERMISSIONS } from "@/lib/admin-access";
import { fetchActivityLogs } from "@/lib/administration";

export const dynamic = "force-dynamic";

/**
 * Lightweight feed for the AdminShell notification bell — latest admin
 * activity (who changed what). Any signed-in admin may read it; the full
 * filterable log page stays `manageAdmins`-gated.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, ALL_PERMISSIONS);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const logs = await fetchActivityLogs(15);
  return NextResponse.json(
    { logs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
