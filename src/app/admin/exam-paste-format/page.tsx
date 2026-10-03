import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PasteFormatViewer from "./viewer";

export const metadata: Metadata = {
  title: "Paste Format — MediSpark Admin",
  description:
    "Admin-only exam paste format guide — paste questions so Detect works.",
  robots: { index: false, follow: false },
};

/**
 * Admin-only route — lives under `/admin/*` so `AdminShell` RBAC
 * (`hasControlAccess` + `/admin/exam-paste-format` control mapping) guards
 * it, and the guide HTML is read from a non-public file (never `public/`,
 * so there is no public URL).
 */
export default async function AdminExamPasteFormatPage() {
  const html = await readFile(
    join(process.cwd(), "src/app/admin/exam-paste-format/guide.html"),
    "utf8",
  );
  return <PasteFormatViewer html={html} />;
}
