import type { Metadata } from "next";
import RulesManager from "@/components/admin/RulesManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "নিয়ম — MediSpark Admin",
  description: "শুধু অ্যাডমিনদের জন্য ভেতরের নিয়ম।",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

/**
 * Legacy /rules.html URL — strictly admin-only.
 * - No rule content is rendered server-side (empty shell only).
 * - The client gate requires Firebase sign-in + /api/admin authorization;
 *   unauthenticated users are sent to /login, non-admins to /.
 * - All rule data flows through /api/admin/rules* which enforce
 *   requireAnyPermission(["manageSystem","manageAdmins"]) server-side with
 *   no-store responses.
 */
export default function RulesHtmlPage() {
  return <RulesManager standalone />;
}
