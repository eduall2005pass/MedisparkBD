import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import { logAdminAction } from "@/lib/administration";
import {
  fetchNotifications,
  saveNotification,
  deleteNotification,
  setNotificationActive,
} from "@/lib/content-admin";

export const dynamic = "force-dynamic";

/** ?all=1 — include inactive notifications (admin view). */
export async function GET(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const all = request.nextUrl.searchParams.get("all") === "1";
  const notifications = await fetchNotifications(all);
  return NextResponse.json(
    { notifications },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // The admin console only ever creates MANUAL notifications — automatic
  // rows are written by the system event engine, never from here.
  const payload: Record<string, unknown> = { ...body, origin: "manual" };
  // Course-scoped enrolled targeting: only honored for audience "enrolled".
  if (typeof body.targetCourseId === "string" && body.targetCourseId.trim()) {
    payload.targetCourseId = body.targetCourseId.trim();
  }
  try {
    const rawId = typeof body.id === "string" ? body.id.trim() : "";
    // Idempotency: check BEFORE save — a retry carrying an id that already
    // exists must not duplicate the row (saveNotification upserts by id)
    // nor re-push. (Checked pre-save so a first-time create with an
    // explicit id still pushes.)
    let isRetry = false;
    if (rawId) {
      try {
        const existing = await fetchNotifications(true);
        isRetry = existing.some((n) => n.id === rawId);
      } catch {
        isRetry = false;
      }
    }
    const notifications = await saveNotification(payload, admin.uid);
    await logAdminAction(admin, "notification.save", String(body.title ?? ""), request);
    // Push to devices on fresh publishes (not on edits): best-effort, never
    // fails the save. Tapping the push opens the notification link.
    // Scope matches the inbox audience — "enrolled" pushes ONLY to that
    // course's students (never a leaky broadcast); "student" is pushed
    // explicitly by the Specific Student page, so it's skipped here.
    let push: { sent: number; failed: number; error?: string; deduped?: boolean } | null = null;
    const isNew = !rawId;
    if (isRetry) {
      push = { sent: 0, failed: 0, deduped: true };
    } else if (isNew && payload.isActive !== false) {
      try {
        const { sendPush, sendPushToUids } = await import("@/lib/push-admin");
        const { sanitizeNotificationLink } = await import("@/lib/content-admin");
        const url = sanitizeNotificationLink(body.link) ?? "/dashboard/notifications";
        const title = String(body.title ?? "MediSpark");
        const text = String(body.message ?? "");
        if (payload.audience === "all" || payload.audience === "students") {
          const result = await sendPush({ title, body: text, url });
          push = { sent: result.sent, failed: result.failed };
        } else if (
          payload.audience === "enrolled" &&
          typeof payload.targetCourseId === "string" &&
          payload.targetCourseId
        ) {
          const { query } = await import("@/lib/mysql");
          const enrolled = await query<{ student_uid: string }[]>(
            `SELECT DISTINCT student_uid FROM enrollments WHERE course_id = ? AND enrollment_status = 'active' LIMIT 5000`,
            [payload.targetCourseId],
          );
          const result = await sendPushToUids(
            enrolled.map((e) => e.student_uid),
            { title, body: text, url },
          );
          push = { sent: result.sent, failed: result.failed };
        }
        if (push) {
          await logAdminAction(admin, "notification.push", `audience=${String(payload.audience)} sent=${push.sent} failed=${push.failed}`, request);
        }
      } catch (error) {
        // Push infra (Firebase) missing or failing — surface the failure so
        // callers never mistake it for a clean {sent:0,failed:0} success.
        // The in-app notice is still saved.
        const detail = error instanceof Error ? error.message : "Push delivery failed.";
        push = { sent: 0, failed: 0, error: detail };
      }
    }
    return NextResponse.json({ notifications, push });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save the notification.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** PATCH { id, isActive } — enable / disable without touching content. */
export async function PATCH(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    isActive?: unknown;
  } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Missing notification id." }, { status: 400 });
  }
  await setNotificationActive(body.id, body.isActive !== false);
  await logAdminAction(
    admin,
    body.isActive !== false ? "notification.enable" : "notification.disable",
    body.id,
    request,
  );
  const notifications = await fetchNotifications(true);
  return NextResponse.json({ notifications });
}

export async function DELETE(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Missing notification id." }, { status: 400 });
  }
  await deleteNotification(body.id);
  const notifications = await fetchNotifications(true);
  return NextResponse.json({ notifications });
}
