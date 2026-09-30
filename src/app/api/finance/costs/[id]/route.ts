import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { logAdminAction } from "@/lib/administration";
import {
  fetchCostById,
  softDeleteManualCost,
  updateManualCost,
  validateCostInput,
} from "@/lib/finance";

/** 401 (unauthenticated) vs 403 (authenticated, no permission). */
function denied() {
  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}
function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export const dynamic = "force-dynamic";

function idFrom(request: NextRequest): number | null {
  const parts = new URL(request.url).pathname.split("/");
  const id = Number(parts[parts.length - 1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PATCH /api/finance/costs/[id] — permission-gated. Whitelisted fields only. */
export async function PATCH(request: NextRequest) {
  const admin = await requireAnyPermission(request, [
    "manageSystem",
    "manageCourses",
  ]);
  if (!admin) {
    const user = await getFirebaseUser(request);
    return user ? denied() : unauthorized();
  }
  const id = idFrom(request);
  if (!id) {
    return NextResponse.json({ error: "Invalid record id." }, { status: 400 });
  }
  const existing = await fetchCostById(id);
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = validateCostInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  // created_by / ids can never be changed — validateCostInput strips them,
  // and updateManualCost only writes the whitelisted columns.
  const updated = await updateManualCost(
    id,
    parsed.value,
    { uid: admin.uid, email: admin.email ?? null },
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update the record." },
      { status: 500 },
    );
  }
  await logAdminAction(
    { uid: admin.uid, email: admin.email },
    "finance.update",
    `#${id} ${existing.itemName} ৳${existing.amount} → ৳${updated.amount}`,
    request,
  );
  return NextResponse.json({ cost: updated });
}

/** DELETE /api/finance/costs/[id] — permission-gated, SOFT delete. */
export async function DELETE(request: NextRequest) {
  const admin = await requireAnyPermission(request, [
    "manageSystem",
    "manageCourses",
  ]);
  if (!admin) {
    const user = await getFirebaseUser(request);
    return user ? denied() : unauthorized();
  }
  const id = idFrom(request);
  if (!id) {
    return NextResponse.json({ error: "Invalid record id." }, { status: 400 });
  }
  const existing = await fetchCostById(id);
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  const ok = await softDeleteManualCost(id, {
    uid: admin.uid,
    email: admin.email ?? null,
  });
  if (!ok) {
    return NextResponse.json(
      { error: "Failed to delete the record." },
      { status: 500 },
    );
  }
  await logAdminAction(
    { uid: admin.uid, email: admin.email },
    "finance.delete",
    `#${id} ${existing.itemName} soft-deleted`,
    request,
  );
  return NextResponse.json({ message: "Record moved to history." });
}
