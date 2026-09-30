/**
 * Client-safe role constants.
 *
 * Single source of truth lives in `@/lib/admin-access` (dependency-free, safe
 * for browser bundles). This module re-exports it so existing
 * `@/lib/admin-roles` imports keep working without duplicating the constants.
 *
 * Do NOT import "@/lib/administration" or "@/lib/mysql" here — this module is
 * pulled into browser bundles (client components). Keeping the role constants
 * isolated avoids dragging the server-only mysql2 stack into the client bundle,
 * which otherwise breaks `next build` (net/tls can't be resolved in the browser).
 */

export {
  AVAILABLE_ROLES,
  ROLE_LABELS,
  type AdminRole,
} from "./admin-access";
