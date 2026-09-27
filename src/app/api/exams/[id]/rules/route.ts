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
  // Exam meta first (needed for 404/draft + template key); rule rows for
  // both languages resolve afterwards in parallel.
  const exam = await fetchExamPageById(id);
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
  // Per-exam overrides + central template fallback, resolved PER LANGUAGE —
  // Bangla-version students see Bangla rules, English-version see English.
  async function rulesFor(lang: "bangla" | "english") {
    const stored = await fetchExamRules(id, lang);
    if (stored.length > 0) return { rows: stored, customizable: true };
    try {
      const { fetchTemplateRules, normalizeTemplate, buildDefaultTemplateRules } =
        await import("@/lib/exam-rule-templates");
      const key = normalizeTemplate(
        (exam as unknown as { ruleTemplate?: string | null }).ruleTemplate,
      );
      const tpl = await fetchTemplateRules(key, lang);
      if (tpl.length > 0) {
        return {
          rows: tpl.map((r, i) => ({ id: r.id, examId: id, lang, title: r.title, text: r.text, sortOrder: r.sortOrder ?? i + 1 })),
          customizable: false,
        };
      }
      return {
        rows: buildDefaultTemplateRules(key, lang).map((r, i) => ({
          id: null, examId: id, lang, title: r.title, text: r.text, sortOrder: i + 1,
        })),
        customizable: false,
      };
    } catch {
      return { rows: buildDefaultExamRules(id, null, lang), customizable: false };
    }
  }
  const [bn, en] = await Promise.all([rulesFor("bangla"), rulesFor("english")]);
  const rules = bn.rows;
  // English falls back to Bangla text when the admin hasn't written English yet.
  const rulesEn = en.rows.length > 0 ? en.rows : bn.rows;
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
      rulesEn,
      customizable: bn.customizable || en.customizable,
      secondTimerEnabled: exam.secondTimerEnabled,
      secondTimerDeduction: exam.secondTimerDeduction,
      versions,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
