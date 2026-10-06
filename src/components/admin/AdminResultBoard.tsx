"use client";

import ResultBoard from "@/components/ResultBoard";
import { AccessLoading, AccessMessage } from "@/components/auth/AccessGuard";
import { hasControlAccess, useAdminGate } from "@/components/admin/admin-ui";

/** Admin-only wrapper around the result board (Result Control grant). */
export default function AdminResultBoard() {
  const gate = useAdminGate();
  if (!gate.ready) {
    return gate.denied ? (
      <AccessMessage
        title="Administrators only"
        message="Results are visible from the Admin Panel only."
        actionLabel="Back to Home"
        actionHref="/"
      />
    ) : (
      <AccessLoading label="Checking access…" />
    );
  }
  if (!hasControlAccess(gate.role, gate.permissions, "/admin/result-control")) {
    return (
      <AccessMessage
        title="Administrators only"
        message="Results are visible from the Admin Panel only."
        actionLabel="Back to Home"
        actionHref="/"
      />
    );
  }
  return <ResultBoard authHeaders={gate.headers} />;
}
