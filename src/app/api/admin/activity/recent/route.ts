import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { ALL_PERMISSIONS } from "@/lib/admin-access";
import { fetchActivityLogs, pruneActivityLogs } from "@/lib/administration";
import { fetchEnrollmentsAdmin } from "@/lib/enrollments-admin";

export const dynamic = "force-dynamic";

/**
 * Feed for the AdminShell notification bell:
 *  - `pending` — enrollment requests waiting for admin approval
 *    (visible only to roles that manage enrollments/students),
 *  - `logs` — latest admin activity (any admin may read).
 * The badge counts pending work, so the bell lights up only when there
 * is something to act on.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, ALL_PERMISSIONS);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [logs, canSeeEnrollments] = await Promise.all([
    fetchActivityLogs(8),
    requireAnyPermission(request, [
      "manageStudents",
      "manageCourses",
      "manageSystem",
      "manageAdmins",
    ]).then(Boolean),
  ]);
  // 30-day retention: auto-delete older audit rows (best-effort).
  void pruneActivityLogs();

  let pending: Array<{
    id: number;
    studentName: string;
    courseId: string;
    courseName: string;
    courseKind: "free" | "paid";
    fee: number;
    createdAt: number | null;
  }> = [];
  if (canSeeEnrollments) {
    try {
      const rows = await fetchEnrollmentsAdmin({ status: "pending" });
      pending = rows.slice(0, 15).map((row) => ({
        id: row.id,
        studentName: row.studentName || row.studentEmail || "Student",
        courseId: row.courseId,
        courseName: row.courseName,
        courseKind: row.courseKind,
        fee: row.fee,
        createdAt: row.paymentDate ?? row.enrolledAt,
      }));
    } catch {
      pending = [];
    }
  }

  return NextResponse.json(
    { logs, pending },
    { headers: { "Cache-Control": "no-store" } },
  );
}
