import { NextRequest, NextResponse } from "next/server";
import { buildDefaultExamRules, fetchExamRules } from "@/lib/exam-rules";
import { fetchExamPageById } from "@/lib/public-exams-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/[id]/rules — the rule set of ONE specific exam, loaded
 * from MySQL (Admin-managed). Falls back to MediSpark's standard rules
 * when the admin has not customised them yet.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  // Exam meta + rule rows are independent DB reads — run them together
  // instead of sequentially so the rules page loads ~2x faster.
  const [exam, stored] = await Promise.all([
    fetchExamPageById(id),
    fetchExamRules(id),
  ]);
  if (!exam) {
    // Distinguish missing ID vs draft to avoid false "No exam found" on status mismatches
    const { fetchExamById } = await import("@/lib/exams-admin");
    const direct = await fetchExamById(id);
    if (!direct) {
      return NextResponse.json({ error: "Exam not found." }, { status: 404 });
    }
    if (direct.status === "draft") {
      return NextResponse.json({ error: "This exam is not published yet." }, { status: 403 });
    }
    return NextResponse.json({ error: "Exam not found or not available." }, { status: 404 });
  }
  const rules =
    stored.length > 0
      ? stored
      : await (async () => {
          // No per-exam override — serve the central template (Exam Rules page).
          try {
            const { fetchTemplateRules, normalizeTemplate, buildDefaultTemplateRules } =
              await import("@/lib/exam-rule-templates");
            const key = normalizeTemplate(
              (exam as unknown as { ruleTemplate?: string | null }).ruleTemplate,
            );
            const tpl = await fetchTemplateRules(key);
            if (tpl.length > 0) {
              return tpl.map((r, i) => ({ id: r.id, examId: id, title: r.title, text: r.text, sortOrder: r.sortOrder ?? i + 1 }));
            }
            return buildDefaultTemplateRules(key).map((r, i) => ({
              id: null,
              examId: id,
              title: r.title,
              text: r.text,
              sortOrder: i + 1,
            }));
          } catch {
            return buildDefaultExamRules(id);
          }
        })();
  // Language versions available for this exam (coverage per version/set).
  // Students must pick one version; legacy exams without variants serve the
  // same base paper for both versions.
  let versions: { totalSlots: number; coverage: Record<string, number>; hasAnyVariant: boolean } | null = null;
  try {
    const { variantCoverage } = await import("@/lib/exam-variants");
    versions = await variantCoverage(id);
  } catch {
    versions = null;
  }
  return NextResponse.json(
    {
      examId: id,
      examName: exam.name,
      rules,
      customizable: stored.length > 0,
      secondTimerEnabled: exam.secondTimerEnabled,
      secondTimerDeduction: exam.secondTimerDeduction,
      versions,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
