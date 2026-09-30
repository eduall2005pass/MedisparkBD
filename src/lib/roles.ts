/**
 * @deprecated — orphan 2-role matrix removed. Import from
 * `@/lib/admin-access` (canonical 10-permission matrix) instead.
 *
 * This file is kept as a thin re-export shim so any existing import keeps
 * working. Fail-closed: unknown roles deny (return false), never throw.
 */

export type {
  AdminRole as Role,
  AdminPermission as Permission,
} from "./admin-access";
export {
  ALL_PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  DEFAULT_PERMISSIONS_BY_ROLE as rolePermissions,
  sanitizePermissions,
} from "./admin-access";
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS_BY_ROLE,
} from "./admin-access";

/** @deprecated Use `hasAdminPermission` / `hasAnyPermission` from `@/lib/admin-access` instead. */
export function hasPermission(
  role: string | null | undefined,
  permission: string,
): boolean {
  if (typeof permission !== "string" || permission.length === 0) return false;
  // Admin holds every known permission.
  if (role === "admin") {
    return (ALL_PERMISSIONS as readonly string[]).includes(permission);
  }
  // Unknown role → deny (previously threw on `undefined.includes`).
  if (typeof role !== "string") return false;
  const matrix = (DEFAULT_PERMISSIONS_BY_ROLE as Record<string, readonly string[]>)[role];
  if (!matrix) return false;
  return matrix.includes(permission);
}
