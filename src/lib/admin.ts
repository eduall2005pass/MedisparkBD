import { NextRequest } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { query, isMysqlConfigured } from "@/lib/mysql";
import { resolveAdminPermissions, type AdminPermission } from "@/lib/administration";
import type { DecodedIdToken } from "firebase-admin/auth";

export type AdminAccount = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

/**
 * Checks whether the given Firebase UID is an authorized admin.
 * Admin accounts are stored in the `admins` table — see
 * src/sql/logo-admin-migration.sql. Writes to website settings are
 * rejected unless the caller resolves to an admin here.
 *
 * Email fallback keeps access working when the underlying Firebase project
 * (and therefore UID) changes — but it is BOUND: it only applies when the
 * caller's UID is not known to the `admins` table at all. A UID that is
 * known but inactive/unauthorized can never inherit admin via email, so a
 * re-registered email cannot escalate a different account.
 *
 * Fail-closed: any query error denies (returns false). Only verified emails
 * are trusted — callers must pass `null` unless `email_verified === true`.
 */
export async function isAdminUid(
  uid: string | null,
  email?: string | null,
): Promise<boolean> {
  if (!isMysqlConfigured) return false;

  const hasUid = typeof uid === "string" && uid.length > 0;
  const cleanEmail = typeof email === "string" && email.length > 0 ? email : null;
  if (!hasUid && !cleanEmail) return false;

  try {
    // Primary: match by UID (binds identity to the stored row).
    if (hasUid) {
      const uidRows = await query<{ uid: string }[]>(
        "SELECT uid FROM admins WHERE uid = ? AND is_active = 1 LIMIT 1",
        [uid],
      );
      if (uidRows.length > 0) return true;
      // Bind the email fallback: this UID is known to the table, so it must
      // never fall through to email matching (that would let a re-registered
      // email inherit another row's admin grant).
      const known = await query<{ uid: string }[]>(
        "SELECT uid FROM admins WHERE uid = ? LIMIT 1",
        [uid],
      );
      if (known.length > 0) return false;
    }
    // Fallback (UID unknown — e.g. Firebase project change): match an active
    // row by verified email.
    if (cleanEmail) {
      const emailRows = await query<{ uid: string }[]>(
        "SELECT uid FROM admins WHERE is_active = 1 AND LOWER(email) = LOWER(?) LIMIT 1",
        [cleanEmail],
      );
      return emailRows.length > 0;
    }
    return false;
  } catch {
    // Fail CLOSED: deny on any query error (no legacy plain lookup — it
    // ignored is_active and could re-authorize deactivated admins).
    return false;
  }
}

export async function fetchAdminAccount(
  uid: string,
): Promise<AdminAccount | null> {
  if (!isMysqlConfigured) return null;
  try {
    const rows = await query<
      { uid: string; email: string | null; display_name: string | null }[]
    >("SELECT uid, email, display_name FROM admins WHERE uid = ? LIMIT 1", [
      uid,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      uid: row.uid,
      email: row.email,
      displayName: row.display_name,
    };
  } catch {
    return null;
  }
}

/**
 * Discriminated gate result so routes can return 401 vs 403 distinctly:
 * - `unauthenticated` → caller has no valid session → respond 401.
 * - `forbidden`       → caller is signed in but not an admin (or lacks the
 *                       permission) → respond 403.
 * The legacy `requireAdmin` / `requirePermission` / `requireAnyPermission`
 * wrappers below conflate both to `null` (callers respond 401); prefer the
 * `*Result` variants in new code.
 */
export type AdminGateResult =
  | { status: "ok"; user: DecodedIdToken }
  | { status: "unauthenticated"; user: null }
  | { status: "forbidden"; user: null };

function verifiedEmail(user: DecodedIdToken): string | null {
  return user.email_verified === true ? (user.email ?? null) : null;
}

/**
 * Verifies the caller is an authenticated, authorized admin.
 * Returns the decoded token on success, null otherwise.
 */
export async function requireAdminResult(
  request: NextRequest,
): Promise<AdminGateResult> {
  const user = await getFirebaseUser(request);
  if (!user) return { status: "unauthenticated", user: null };
  // Email fallback keeps access working even when the underlying Firebase
  // project (and therefore UID) changes. Only verified emails are trusted.
  const authorized = await isAdminUid(user.uid, verifiedEmail(user));
  if (!authorized) return { status: "forbidden", user: null };
  return { status: "ok", user };
}

/**
 * Verifies the caller is an authenticated, authorized admin.
 * Returns the decoded token on success, null otherwise.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<DecodedIdToken | null> {
  const result = await requireAdminResult(request);
  return result.status === "ok" ? result.user : null;
}

/**
 * Role-based gate: like requireAdmin, but additionally enforces that the
 * admin's role grants the requested permission. Returns null when the
 * caller is not an admin or lacks the permission.
 *
 * Centralized: every admin mutation flows through here → `resolveAdminPermissions`
 * → `role_permissions` matrix. UI (hasControlAccess) and API (this gate) share
 * the same canonical permission set (`src/lib/admin-access.ts`). If a permission
 * is ON in Admin Center, this gate allows it; if OFF, it denies it.
 */
export async function requirePermissionResult(
  request: NextRequest,
  permission: AdminPermission,
): Promise<AdminGateResult> {
  const user = await getFirebaseUser(request);
  if (!user) return { status: "unauthenticated", user: null };
  // Single consistent identity: verified token email + UID. `isAdminUid` and
  // `resolveAdminPermissions` both resolve from exactly these inputs (the
  // latter falls back to the UID-bound `admins` row email internally), so the
  // gate and the role can never skew via an unverified account email.
  const email = verifiedEmail(user);
  const [authorized, resolved] = await Promise.all([
    isAdminUid(user.uid, email),
    resolveAdminPermissions(email, user.uid),
  ]);
  if (!authorized) return { status: "forbidden", user: null };
  // Admin always passes; other roles must have the specific permission.
  if (resolved.role === "admin") return { status: "ok", user };
  if (resolved.permissions.includes(permission))
    return { status: "ok", user };
  return { status: "forbidden", user: null };
}

export async function requirePermission(
  request: NextRequest,
  permission: AdminPermission,
): Promise<DecodedIdToken | null> {
  const result = await requirePermissionResult(request, permission);
  return result.status === "ok" ? result.user : null;
}

/**
 * Flexible gate: succeeds if the admin has ANY of the listed permissions.
 * Admin always passes. Used for Teacher-scoped controls where either
 * the granular or the legacy broad permission should grant access.
 */
export async function requireAnyPermissionResult(
  request: NextRequest,
  permissions: readonly AdminPermission[],
): Promise<AdminGateResult> {
  const user = await getFirebaseUser(request);
  if (!user) return { status: "unauthenticated", user: null };
  // Same consistent identity as requirePermissionResult (verified email + UID).
  const email = verifiedEmail(user);
  const [authorized, resolved] = await Promise.all([
    isAdminUid(user.uid, email),
    resolveAdminPermissions(email, user.uid),
  ]);
  if (!authorized) return { status: "forbidden", user: null };
  // Admin always passes.
  if (resolved.role === "admin") return { status: "ok", user };
  // Other roles need at least one matching permission.
  if (permissions.some((p) => resolved.permissions.includes(p)))
    return { status: "ok", user };
  return { status: "forbidden", user: null };
}

export async function requireAnyPermission(
  request: NextRequest,
  permissions: readonly AdminPermission[],
): Promise<DecodedIdToken | null> {
  const result = await requireAnyPermissionResult(request, permissions);
  return result.status === "ok" ? result.user : null;
}