import { NextRequest } from "next/server";
import { exec, parseJsonColumn, query } from "@/lib/mysql";

let ensureSecurityTableReady = false;
let ensureRolePermissionsTableReady = false;
let ensureRolesTableReady = false;
let ensureLogTableReady = false;
// Admin Panel → Administration. Admin account management (rows in the
// `admins` table), role assignments (`admin_roles`), activity logging
// (`admin_activity_logs`) and security policy settings.

export type AdminAccountRow = {
  uid: string;
  email: string | null;
  display_name: string | null;
  photo_url?: string | null;
  phone_number?: string | null;
};

export type RoleAssignment = {
  email: string;
  role: string;
  permissions: string[];
};

export type ActivityLogEntry = {
  id: number;
  adminUid: string;
  adminEmail: string;
  action: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export type SecuritySettings = {
  allowedEmailDomains: string[];
  maxLoginAttempts: number;
  sessionTimeoutMinutes: number;
  requireStrongPassword: boolean;
  blockSuspiciousIps: boolean;
};

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return String(value ?? "");
}

// ── Activity logs ────────────────────────────────────────────────────────

async function ensureLogTable(): Promise<void> {
  if (ensureLogTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_uid VARCHAR(191) NOT NULL DEFAULT '',
    admin_email VARCHAR(191) NOT NULL DEFAULT '',
    action VARCHAR(191) NOT NULL,
    detail TEXT NULL,
    ip_address VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY admin_activity_logs_created_idx (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensureLogTableReady = true;
}

/** Best-effort audit log write — never throws into the caller's flow. */
export async function logAdminAction(
  admin: { uid: string; email?: string | null },
  action: string,
  detail?: string,
  request?: NextRequest,
): Promise<void> {
  try {
    await ensureLogTable();
    const ip =
      request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request?.headers.get("x-real-ip") ??
      null;
    await exec(
      `INSERT INTO admin_activity_logs (admin_uid, admin_email, action, detail, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [admin.uid, admin.email ?? "", action.slice(0, 190), detail ?? null, ip],
    );
  } catch {
    // Logging must never break the request.
  }
}

export async function fetchActivityLogs(
  limit = 200,
): Promise<ActivityLogEntry[]> {
  return fetchFilteredActivityLogs({}, limit);
}

export type ActivityLogFilters = {
  /** Free-text search across admin email, action and detail. */
  q?: string;
  /** Module name — matched as the prefix before the dot in `action`. */
  module?: string;
  /** Action verb — e.g. save, delete, login (matches any module). */
  action?: string;
  /** ISO date — only entries on/after this day. */
  from?: string;
  /** ISO date — only entries on/before this day. */
  to?: string;
};

export async function fetchFilteredActivityLogs(
  filters: ActivityLogFilters,
  limit = 200,
): Promise<ActivityLogEntry[]> {
  try {
    await ensureLogTable();
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.q && filters.q.trim()) {
      const like = `%${filters.q.trim()}%`;
      where.push("(admin_email LIKE ? OR action LIKE ? OR detail LIKE ?)");
      params.push(like, like, like);
    }
    if (filters.module && filters.module.trim()) {
      where.push("action LIKE ?");
      params.push(`${filters.module.trim()}.%`);
    }
    if (filters.action && filters.action.trim()) {
      const verb = filters.action.trim();
      where.push("(action = ? OR action LIKE CONCAT('%.', ?))");
      params.push(verb, verb);
    }
    if (filters.from && filters.from.trim()) {
      where.push("created_at >= ?");
      params.push(`${filters.from.trim()} 00:00:00`);
    }
    if (filters.to && filters.to.trim()) {
      where.push("created_at <= ?");
      params.push(`${filters.to.trim()} 23:59:59`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query<{
      id: number;
      admin_uid: string;
      admin_email: string;
      action: string;
      detail: string | null;
      ip_address: string | null;
      created_at: Date | string;
    }[]>(
      `SELECT * FROM admin_activity_logs ${clause} ORDER BY created_at DESC LIMIT ${Math.min(1000, Math.max(1, limit))}`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      adminUid: row.admin_uid,
      adminEmail: row.admin_email,
      action: row.action,
      detail: row.detail,
      ipAddress: row.ip_address,
      createdAt: toIso(row.created_at),
    }));
  } catch {
    return [];
  }
}

/** Retention window for the audit log — rows older than this are auto-deleted. */
export const ACTIVITY_LOG_RETENTION_DAYS = 30;

let lastActivityPruneAt = 0;
const ACTIVITY_PRUNE_THROTTLE_MS = 60 * 60 * 1000;

/**
 * Auto-delete audit rows older than 30 days (DB-level cleanup).
 * Best-effort and throttled to at most once per hour per server instance —
 * callers (activity APIs) invoke it fire-and-forget on every read.
 * Returns the number of deleted rows.
 */
export async function pruneActivityLogs(): Promise<number> {
  try {
    if (Date.now() - lastActivityPruneAt < ACTIVITY_PRUNE_THROTTLE_MS) return 0;
    lastActivityPruneAt = Date.now();
    await ensureLogTable();
    const result = await exec(
      `DELETE FROM admin_activity_logs
        WHERE created_at < (NOW() - INTERVAL ${ACTIVITY_LOG_RETENTION_DAYS} DAY)`,
    );
    return result.affectedRows ?? 0;
  } catch {
    return 0;
  }
}

/** Records a login event at most once per 30 minutes per admin. */
export async function recordAdminLogin(
  admin: { uid: string; email?: string | null },
): Promise<void> {
  try {
    await ensureLogTable();
    const recent = await query<{ id: number }[]>(
      `SELECT id FROM admin_activity_logs
       WHERE admin_uid = ? AND action = 'login'
         AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
       LIMIT 1`,
      [admin.uid],
    );
    if (recent.length === 0) {
      await logAdminAction(admin, "login");
    }
  } catch {
    // Ignore.
  }
}

// ── Roles & permissions ──────────────────────────────────────────────────
// Canonical Role → Permission → Control definitions live in
// `src/lib/admin-access.ts` (dependency-free, shared with client code).
// This module re-exports them and adds the server-side (MySQL-backed)
// role resolution. Do NOT redefine the matrix or control map here.
export {
  AVAILABLE_ROLES,
  ROLE_LABELS,
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  ADMIN_CONTROL_PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  PUBLIC_EXAM_PERMISSIONS,
  normalizeControlPath,
  resolveControlPermissions,
  hasControlAccess,
  hasAnyPermission,
  hasAdminPermission,
  hasPublicExamAccess,
  sanitizePermissions,
} from "@/lib/admin-access";
export type { AdminPermission, AdminRole } from "@/lib/admin-access";
import {
  ALL_PERMISSIONS,
  AVAILABLE_ROLES,
  DEFAULT_PERMISSIONS_BY_ROLE,
  ADMIN_ONLY_PERMISSIONS,
  sanitizePermissions,
  type AdminPermission,
  type AdminRole,
} from "@/lib/admin-access";

// `ADMIN_CONTROL_PERMISSIONS`, `hasControlAccess` and `hasAnyPermission` are
// re-exported from the canonical `src/lib/admin-access.ts` above (fail-closed,
// segment-aware longest-prefix match). See that module for the full map.

async function ensureRolesTable(): Promise<void> {
  if (ensureRolesTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS admin_roles (
    email VARCHAR(191) NOT NULL PRIMARY KEY,
    role VARCHAR(64) NOT NULL DEFAULT 'admin',
    permissions JSON NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(191) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensureRolesTableReady = true;
}

async function ensureRolePermissionsTable(): Promise<void> {
  if (ensureRolePermissionsTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(64) NOT NULL PRIMARY KEY,
    permissions JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(191) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensureRolePermissionsTableReady = true;
}

/** Configured permission set for a role; falls back to built-in defaults. */
export async function fetchRolePermissions(): Promise<Record<string, string[]>> {
  await ensureRolePermissionsTable();
  const result: Record<string, string[]> = {};
  // Admin always has all permissions (hardcoded).
  result.admin = [...ALL_PERMISSIONS];
  // Read moderator and teacher permissions from database.
  for (const role of AVAILABLE_ROLES) {
    if (role === "admin") continue;
    try {
      const rows = await query<{ permissions: string }[]>(
        `SELECT permissions FROM role_permissions WHERE role = ? LIMIT 1`,
        [role],
      );
      if (rows[0]?.permissions) {
        const parsed = JSON.parse(rows[0].permissions) as unknown;
        if (Array.isArray(parsed)) {
          result[role] = sanitizePermissions(parsed).filter(
            // `manageAdmins` is Admin-only and can never be persisted for
            // other roles (also enforced on save) — belt and suspenders.
            (p) => !ADMIN_ONLY_PERMISSIONS.includes(p),
          );
          continue;
        }
      }
    } catch {
      // Fall through to defaults.
    }
    // Default permissions when no DB row exists (canonical matrix).
    result[role] = [...DEFAULT_PERMISSIONS_BY_ROLE[role as AdminRole]];
  }
  return result;
}

/** Bulk-save the configurable permission matrix (Admin only). */
export async function saveRolePermissions(
  input: Record<string, unknown>,
  adminUid: string,
): Promise<Record<string, string[]>> {
  await ensureRolePermissionsTable();
  for (const [role, rawPermissions] of Object.entries(input)) {
    if (!(AVAILABLE_ROLES as readonly string[]).includes(role)) {
      throw new Error(`Unknown role: ${role}`);
    }
    // The Admin permission set is fixed (all permissions) — ignore any
    // stored override so Admin can never be downgraded via the matrix.
    if (role === "admin") continue;
    if (!Array.isArray(rawPermissions)) continue;
    // `manageAdmins` is Admin-only: strip it so Moderator/Teacher can never
    // gain Admin Center access through the matrix (the role UIs also forbid
    // toggling it — this is the server-side enforcement).
    const permissions = sanitizePermissions(rawPermissions).filter(
      (permission) => !ADMIN_ONLY_PERMISSIONS.includes(permission),
    );
    await exec(
      `INSERT INTO role_permissions (role, permissions, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), updated_by = VALUES(updated_by)`,
      [role, JSON.stringify(permissions), adminUid],
    );
  }
  return fetchRolePermissions();
}

/**
 * Resolve an admin's role and effective permissions.
 * Role assignment lives in `admin_roles` (email-keyed, defaults to
 * "admin" for legacy accounts); the permission matrix comes from `role_permissions`.
 * Admin always holds every permission. This is the SINGLE source of truth for
 * server-side authorization — every `requirePermission` call flows through here.
 *
 * Fail-closed: unknown email, DB error, or missing role → deny (empty permissions).
 * Legacy admins without an explicit `admin_roles` entry default to Admin ONLY if
 * their email is known in the `admins` table; otherwise they are denied.
 */
export async function resolveAdminPermissions(
  email: string | null | undefined,
  uid: string | null | undefined = null,
): Promise<{ role: AdminRole; permissions: AdminPermission[] }> {
  const failClosed: { role: AdminRole; permissions: AdminPermission[] } = {
    role: "teacher",
    permissions: [],
  };
  try {
    await ensureRolesTable();
    let assignedRole: AdminRole | null = null;
    let resolvedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;
    // If email is missing but uid is provided, resolve email from `admins` table
    // so UID-based admins with unverified token emails still get their correct role.
    if (!resolvedEmail && typeof uid === "string" && uid.length > 0) {
      try {
        const uidRows = await query<{ email: string | null }[]>(
          `SELECT email FROM admins WHERE uid = ? LIMIT 1`,
          [uid],
        );
        if (uidRows[0]?.email) resolvedEmail = uidRows[0].email.trim().toLowerCase();
      } catch {
        // ignore, fall through to fail-closed
      }
    }
    if (resolvedEmail) {
      const rows = await query<{ role: string }[]>(
        `SELECT role FROM admin_roles WHERE email = ? LIMIT 1`,
        [resolvedEmail],
      );
      const rawRole = String(rows[0]?.role ?? "").trim().toLowerCase();
      if ((AVAILABLE_ROLES as readonly string[]).includes(rawRole)) {
        assignedRole = rawRole as AdminRole;
      } else if (rawRole === "super-admin") {
        assignedRole = "admin";
      }
      // Fallback to admins.role when no admin_roles entry (e.g., legacy moderator)
      if (!assignedRole) {
        try {
          const adminRows = await query<{ role: string | null }[]>(
            `SELECT role FROM admins WHERE LOWER(email) = LOWER(?) LIMIT 1`,
            [resolvedEmail],
          );
          const adminRole = String(adminRows[0]?.role ?? "").trim().toLowerCase();
          if ((AVAILABLE_ROLES as readonly string[]).includes(adminRole)) {
            assignedRole = adminRole as AdminRole;
          }
        } catch {
          // ignore, use default below
        }
      }
    }
    // No explicit role found — legacy fallback ONLY if this email/uid is a known admin.
    // Unknown emails (not in `admins` table) are denied (fail-closed) instead of
    // being auto-promoted to Admin.
    if (!assignedRole) {
      if (resolvedEmail) {
        try {
          const exists = await query<{ uid: string }[]>(
            `SELECT uid FROM admins WHERE LOWER(email) = LOWER(?) LIMIT 1`,
            [resolvedEmail],
          );
          if (exists.length > 0) {
            assignedRole = "admin";
          } else {
            return failClosed;
          }
        } catch {
          return failClosed;
        }
      } else if (typeof uid === "string" && uid.length > 0) {
        // UID provided but no email resolved — check if UID is a known admin
        try {
          const exists = await query<{ uid: string }[]>(
            `SELECT uid FROM admins WHERE uid = ? LIMIT 1`,
            [uid],
          );
          if (exists.length > 0) {
            assignedRole = "admin";
          } else {
            return failClosed;
          }
        } catch {
          return failClosed;
        }
      } else {
        return failClosed;
      }
    }
    // Admin always has all permissions.
    if (assignedRole === "admin") {
      return { role: "admin", permissions: [...ALL_PERMISSIONS] };
    }
    // Read the role's permissions from the database.
    const matrix = await fetchRolePermissions();
    const perms = (matrix[assignedRole] ?? []) as AdminPermission[];
    return { role: assignedRole, permissions: perms };
  } catch {
    return failClosed;
  }
}

export async function fetchRoleAssignments(): Promise<RoleAssignment[]> {
  try {
    await ensureRolesTable();
    const matrix = await fetchRolePermissions();
    const rows = await query<{
      email: string;
      role: string;
      permissions: string | null;
    }[]>(`SELECT email, role, permissions FROM admin_roles ORDER BY email ASC`);
    return rows.map((row) => {
      let permissions = matrix[row.role] ?? [];
      const parsed = parseJsonColumn<string[]>(row.permissions);
      if (Array.isArray(parsed)) permissions = parsed.map(String);
      return { email: row.email, role: row.role, permissions };
    });
  } catch {
    return [];
  }
}

export async function saveRoleAssignments(
  input: Array<Record<string, unknown>>,
  adminUid: string,
): Promise<RoleAssignment[]> {
  await ensureRolesTable();
  for (const raw of input) {
    const email =
      typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    const role = String(raw.role ?? "admin");
    if (!email.includes("@")) throw new Error(`Invalid email: ${email}`);
    if (!(AVAILABLE_ROLES as readonly string[]).includes(role)) {
      throw new Error(`Unknown role: ${role}`);
    }
    const permissions = Array.isArray(raw.permissions)
      ? raw.permissions.map(String)
      : (await fetchRolePermissions())[role] ?? [];
    await exec(
      `INSERT INTO admin_roles (email, role, permissions, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), permissions = VALUES(permissions),
         updated_by = VALUES(updated_by)`,
      [email, role, JSON.stringify(permissions), adminUid],
    );
  }
  return fetchRoleAssignments();
}

export async function deleteRoleAssignment(email: string): Promise<void> {
  await ensureRolesTable();
  await exec(`DELETE FROM admin_roles WHERE email = ?`, [
    email.trim().toLowerCase(),
  ]);
}

// ── Security settings ────────────────────────────────────────────────────

async function ensureSecurityTable(): Promise<void> {
  if (ensureSecurityTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS security_settings (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    allowed_email_domains JSON NULL,
    max_login_attempts INT NOT NULL DEFAULT 5,
    session_timeout_minutes INT NOT NULL DEFAULT 120,
    require_strong_password TINYINT(1) NOT NULL DEFAULT 0,
    block_suspicious_ips TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(191) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await exec(`INSERT IGNORE INTO security_settings (id) VALUES ('active')`);
  ensureSecurityTableReady = true;
}

const DEFAULT_SECURITY: SecuritySettings = {
  allowedEmailDomains: [],
  maxLoginAttempts: 5,
  sessionTimeoutMinutes: 120,
  requireStrongPassword: false,
  blockSuspiciousIps: false,
};

export async function fetchSecuritySettings(): Promise<SecuritySettings> {
  try {
    await ensureSecurityTable();
    const rows = await query<{
      allowed_email_domains: string | null;
      max_login_attempts: number;
      session_timeout_minutes: number;
      require_strong_password: number | boolean;
      block_suspicious_ips: number | boolean;
    }[]>(`SELECT * FROM security_settings WHERE id = 'active' LIMIT 1`);
    const row = rows[0];
    if (!row) return DEFAULT_SECURITY;
    let domains = DEFAULT_SECURITY.allowedEmailDomains;
    const parsedDomains = parseJsonColumn<string[]>(row.allowed_email_domains);
    if (Array.isArray(parsedDomains)) domains = parsedDomains.map(String);
    return {
      allowedEmailDomains: domains,
      maxLoginAttempts: row.max_login_attempts ?? 5,
      sessionTimeoutMinutes: row.session_timeout_minutes ?? 120,
      requireStrongPassword: Boolean(row.require_strong_password),
      blockSuspiciousIps: Boolean(row.block_suspicious_ips),
    };
  } catch {
    return DEFAULT_SECURITY;
  }
}

export async function saveSecuritySettings(
  input: Record<string, unknown>,
  adminUid: string,
): Promise<SecuritySettings> {
  await ensureSecurityTable();
  const domains = Array.isArray(input.allowedEmailDomains)
    ? input.allowedEmailDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
    : DEFAULT_SECURITY.allowedEmailDomains;
  await exec(
    `UPDATE security_settings SET
       allowed_email_domains = ?, max_login_attempts = ?, session_timeout_minutes = ?,
       require_strong_password = ?, block_suspicious_ips = ?, updated_by = ?
     WHERE id = 'active'`,
    [
      JSON.stringify(domains),
      Math.max(1, Number(input.maxLoginAttempts) || 5),
      Math.max(5, Number(input.sessionTimeoutMinutes) || 120),
      input.requireStrongPassword ? 1 : 0,
      input.blockSuspiciousIps ? 1 : 0,
      adminUid,
    ],
  );
  return fetchSecuritySettings();
}
