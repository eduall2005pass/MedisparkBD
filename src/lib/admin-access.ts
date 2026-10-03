/**
 * Canonical Admin authorization — single source of truth for
 * Role → Permission → Control.
 *
 * This module is intentionally dependency-free (no database, no Firebase,
 * no Next.js imports) so it can be safely imported from BOTH server code
 * (`src/lib/administration.ts`, API routes) and client code
 * (`src/components/admin/admin-ui.ts`, admin pages). Do NOT add
 * server-only imports here, and do NOT duplicate the role matrix or the
 * control map anywhere else — import from here instead.
 *
 * Enforcement layers (all must agree):
 *  - UI:      AdminShell / WebsiteAdminShell / AdminSearch / /admin home filter
 *             navigation and pages via `hasControlAccess`.
 *  - Server:  API routes via `requirePermission` / `requireAnyPermission`
 *             (`src/lib/admin.ts`), which resolve the caller's role with
 *             `resolveAdminPermissions` (`src/lib/administration.ts`).
 * Hiding a button is NOT authorization — every protected mutation is also
 * gated server-side.
 *
 * Fail-closed contract:
 *  - known permission + granted        = ALLOW
 *  - unknown control / missing mapping = DENY
 *  - missing role / missing permission = DENY
 * Only `role === "admin"` bypasses (admin holds every permission), plus the
 * explicit open hub paths (`/admin`, `/admin/profile…`, `/admin/access-denied`).
 */

export const AVAILABLE_ROLES = ["admin", "moderator", "teacher"] as const;

export type AdminRole = (typeof AVAILABLE_ROLES)[number];

export const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Admin",
  moderator: "Moderator",
  teacher: "Teacher",
};

/** Every permission known to the system. */
export const ALL_PERMISSIONS = [
  "manageContent",
  "manageCourses",
  "manageExams",
  "manageStudents",
  "manageAdmins",
  "manageSystem",
  "manageCourseContent",
  "managePublicExam",
  "manageQa",
  "manageResults",
] as const;

export type AdminPermission = (typeof ALL_PERMISSIONS)[number];

function isAdminPermission(value: string): value is AdminPermission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Canonical Role → Permissions matrix (used when no `role_permissions`
 * database override exists).
 *
 * - Admin:     all 10 permissions (global bypass everywhere).
 * - Moderator: all 10 EXCEPT `manageAdmins` — therefore NO `admin-center`
 *              / `administration` access, but full access to every other
 *              control (including `student-control`, `enrollment-control`).
 * - Teacher:   exactly the six teaching/content permissions — therefore NO
 *              `enrollment-control`, `course-control`, `student-control` or
 *              `admin-center` access.
 */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<
  AdminRole,
  readonly AdminPermission[]
> = {
  admin: [...ALL_PERMISSIONS],
  moderator: [
    "manageContent",
    "manageCourses",
    "manageExams",
    "manageStudents",
    "manageSystem",
    "manageCourseContent",
    "managePublicExam",
    "manageQa",
    "manageResults",
  ],
  teacher: [
    "manageContent",
    "manageExams",
    "manageCourseContent",
    "managePublicExam",
    "manageQa",
    "manageResults",
  ],
};

/**
 * Permissions that may ONLY ever be held by `admin`. Enforced server-side in
 * `saveRolePermissions` (`src/lib/administration.ts`): even an Admin cannot
 * persist these for `moderator`/`teacher`, so `admin-center` stays Admin-only.
 */
export const ADMIN_ONLY_PERMISSIONS: readonly AdminPermission[] = [
  "manageAdmins",
];

/**
 * Canonical Control → required Permissions map.
 *
 * Each key is an Admin Panel path prefix; a request path resolves to the
 * LONGEST matching prefix (segment-aware), so nested/dynamic routes such as
 * `/admin/public-exam/category/123` inherit the `public-exam` grant while
 * look-alikes such as `/admin/public-exam-evil` do NOT match.
 *
 * A control lists every permission that grants access (granular permission
 * first, legacy broad permission as fallback) so existing Moderator/Teacher
 * API pairs keep working. Hub cards and their legacy route aliases map to
 * the same permission on purpose — the number of controls and the number of
 * permissions are intentionally NOT identical.
 */
export const ADMIN_CONTROL_PERMISSIONS: Record<
  string,
  readonly AdminPermission[]
> = {
  // ── Hub controls (cards on /admin home) ──────────────────────────────
  "/admin/website-information": ["manageContent"],
  "/admin/enrollment-control": ["manageStudents", "manageCourses"],
  "/admin/home-control": ["manageContent"],
  "/admin/course-control": ["manageCourses"],
  "/admin/course-content-control": ["manageCourseContent", "manageCourses"],
  "/admin/material-pdf": ["manageCourses", "manageCourseContent", "manageExams"],
  "/admin/public-exam-control": ["managePublicExam", "manageExams"],
  // Canonical Public Exam subtree: hub + Category → Exam pages inherit it.
  "/admin/public-exam": ["managePublicExam", "manageExams"],
  // Exam Management (/admin/exams/[id]/manage) belongs to the Public Exam
  // flow — Category → Exam → Manage inherits the parent grant.
  "/admin/exams": ["managePublicExam", "manageExams"],
  // Central rule templates (Admin → Exam Rules). Mirrors the API pair
  // requireAnyPermission(["manageExams", "managePublicExam"]).
  "/admin/exam-rules": ["managePublicExam", "manageExams"],
  // Exam Paste Format guide (admin-only, no public URL). Same grant as
  // Exam Rules — exam managers and teachers with exam access.
  "/admin/exam-paste-format": ["managePublicExam", "manageExams"],
  // Enrolled-exam lists are course-assigned; course managers keep access.
  "/admin/exams/enrolled": ["managePublicExam", "manageExams", "manageCourses"],
  "/admin/qa-control": ["manageQa", "manageContent"],
  "/admin/dashboard-control": ["manageSystem", "manageContent"],
  "/admin/student-control": ["manageStudents"],
  "/admin/result-control": ["manageResults", "manageExams"],
  "/admin/notification-control": ["manageContent", "manageSystem"],
  "/admin/admin-center": ["manageAdmins"],

  // ── Legacy / alias route subtrees (longest-prefix wins) ──────────────
  "/admin/website": ["manageContent"],
  "/admin/settings": ["manageContent"],
  "/admin/branding": ["manageContent"],
  "/admin/homepage-courses": ["manageCourses"],
  "/admin/mentors": ["manageContent"],
  "/admin/content": ["manageContent"],
  "/admin/marketing": ["manageCourses"],
  // Legacy course pages are course-managed…
  "/admin/courses": ["manageCourses"],
  // …except the content-structure sub-pages, where the granular teacher
  // permission is also accepted (mirrors the matching API pairs).
  "/admin/courses/subjects": ["manageCourses", "manageCourseContent"],
  "/admin/courses/chapters": ["manageCourses", "manageCourseContent"],
  "/admin/courses/papers": ["manageCourses", "manageCourseContent", "manageExams"],
  "/admin/courses/classes": ["manageCourses", "manageCourseContent"],
  // Legacy single-course browser.
  "/admin/course": ["manageCourses"],
  "/admin/course-exams": ["managePublicExam", "manageExams", "manageCourses"],
  "/admin/course-content": ["manageCourseContent", "manageCourses"],
  "/admin/enrolled-courses": ["manageCourseContent", "manageCourses"],
  "/admin/my-enrolled-course": ["manageCourseContent", "manageCourses"],
  "/admin/students": ["manageStudents"],
  "/admin/qa": ["manageQa", "manageContent"],
  "/admin/dashboard": ["manageSystem", "manageContent"],
  // System pages: system managers keep access; admins always pass.
  "/admin/system": ["manageSystem", "manageAdmins"],
  // Internal Rules (admin-only source of truth): system operators and admin
  // managers. Teacher has neither permission → denied; non-admins fail closed.
  "/admin/rules": ["manageSystem", "manageAdmins"],
  // Admin/role management: Admin only.
  "/admin/administration": ["manageAdmins"],
};

/**
 * Hub paths that every signed-in admin may open. `/admin` is the navigation
 * hub (cards are filtered per-role inside it); `/admin/profile…` is the
 * caller's own account; `/admin/access-denied` must stay viewable so a
 * denied user is never stuck in a redirect loop. All real data/mutations
 * behind these paths remain permission-gated server-side.
 */
const OPEN_PATH_PREFIXES: readonly string[] = [
  "/admin/profile",
  "/admin/access-denied",
];

/**
 * Normalize a path/href for authorization matching: strip query strings and
 * hashes, ensure a leading slash, drop trailing slashes (except root).
 * Returns "" for empty input (which never matches — fail closed).
 */
export function normalizeControlPath(href: string | null | undefined): string {
  if (typeof href !== "string") return "";
  const withoutQuery = href.split("?")[0].split("#")[0].trim();
  if (!withoutQuery) return "";
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (collapsed.length > 1) {
    return collapsed.replace(/\/+$/, "") || "/";
  }
  return collapsed;
}

/**
 * Longest segment-aware prefix match of a pathname against
 * `ADMIN_CONTROL_PERMISSIONS`. Returns the matched control and its required
 * permissions, or null when the path is outside every controlled subtree.
 *
 * Segment-aware means `/admin/public-exam/category/123` matches
 * `/admin/public-exam`, but `/admin/public-exam-evil` matches nothing.
 */
export function resolveControlPermissions(pathname: string): {
  control: string;
  required: readonly AdminPermission[];
} | null {
  const normalized = normalizeControlPath(pathname);
  if (!normalized) return null;
  let matched: string | null = null;
  for (const control of Object.keys(ADMIN_CONTROL_PERMISSIONS)) {
    if (normalized === control || normalized.startsWith(`${control}/`)) {
      if (!matched || control.length > matched.length) matched = control;
    }
  }
  if (!matched) return null;
  return { control: matched, required: ADMIN_CONTROL_PERMISSIONS[matched] };
}

/**
 * Canonical control access check with subtree inheritance.
 * - `admin` role always passes (holds every permission).
 * - `/admin` hub and the `OPEN_PATH_PREFIXES` always pass for signed-in admins.
 * - Every other path requires at least one of the resolved control's
 *   permissions — unknown/unmapped controls FAIL CLOSED (deny).
 */
export function hasControlAccess(
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  href: string | null | undefined,
): boolean {
  // Admin always has full access.
  if (role === "admin") return true;
  const normalized = normalizeControlPath(href);
  if (!normalized) return false;
  if (normalized === "/admin") return true;
  if (
    OPEN_PATH_PREFIXES.some(
      (open) => normalized === open || normalized.startsWith(`${open}/`),
    )
  ) {
    return true;
  }
  const resolved = resolveControlPermissions(normalized);
  // Unknown control → fail closed.
  if (!resolved) return false;
  const granted = Array.isArray(permissions) ? permissions : [];
  return resolved.required.some((perm) => granted.includes(perm));
}

/** Check if a permission set grants any of the required permissions. */
export function hasAnyPermission(
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  required: readonly string[],
): boolean {
  // Admin always has full access.
  if (role === "admin") return true;
  const granted = Array.isArray(permissions) ? permissions : [];
  return required.some((perm) => granted.includes(perm));
}

/** Client-side convenience: does the current admin's gate grant a permission? */
export function hasAdminPermission(
  gate: { role: string | null; permissions: string[] },
  permission: string,
): boolean {
  // Admin always has all permissions.
  if (gate.role === "admin") return true;
  return gate.permissions.includes(permission);
}

/**
 * Public Exam entry permission — the SAME pair enforced by the backend
 * (`requireAnyPermission(["manageExams", "managePublicExam"])`) and the
 * `ADMIN_CONTROL_PERMISSIONS` map. Category → Exam → Exam Management pages
 * inherit this parent grant.
 */
export const PUBLIC_EXAM_PERMISSIONS = [
  "managePublicExam",
  "manageExams",
] as const;

export function hasPublicExamAccess(gate: {
  role: string | null;
  permissions: string[];
}): boolean {
  if (gate.role === "admin") return true;
  return PUBLIC_EXAM_PERMISSIONS.some((perm) =>
    gate.permissions.includes(perm),
  );
}

/** Keep only known permission strings from a raw value. */
export function sanitizePermissions(raw: unknown): AdminPermission[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(isAdminPermission);
}
