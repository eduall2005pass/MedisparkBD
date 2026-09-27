import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/admin";
import { logAdminAction } from "@/lib/administration";
import {
  backfillExamRulesLang,
  deleteExamRule,
  reorderExamRules,
  saveExamRule,
} from "@/lib/exam-rules";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

/** GET ?examId=…&lang=bangla|english — rules of one exam+language. */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const examId = request.nextUrl.searchParams.get("examId")?.trim() ?? "";
  if (!/^[a-z0-9-]{2,64}$/.test(examId)) {
    return NextResponse.json({ error: "A valid exam is required." }, { status: 400 });
  }
  const lang = request.nextUrl.searchParams.get("lang")?.toLowerCase() === "english" ? "english" : "bangla";
  // Older exams have Bangla rows only — auto-fill the missing language
  // (standard rules translated, custom text copied) on first open.
  const rules = await backfillExamRulesLang(examId, lang);
  return NextResponse.json(
    { examId, lang, rules },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST — add or edit a rule. Body: { examId, lang?, id?, title, text }. */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const rules = await saveExamRule(body);
    await logAdminAction(
      admin,
      "exam-rules.save",
      `exam=${String(body.examId)} id=${String(body.id ?? "new")}`,
      request,
    );
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the rule." },
      { status: 400 },
    );
  }
}

/** PUT — reorder within one exam+lang. Body: { examId, lang?, order: [id, …] }. */
export async function PUT(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as
    | { examId?: unknown; order?: unknown; lang?: unknown }
    | null;
  const examId = typeof body?.examId === "string" ? body.examId.trim() : "";
  if (!/^[a-z0-9-]{2,64}$/.test(examId) || !Array.isArray(body?.order)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const lang = typeof body?.lang === "string" && body.lang.toLowerCase() === "english" ? "english" : "bangla";
  const ids = body!.order.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return NextResponse.json({ rules: await reorderExamRules(examId, ids, lang) });
}

/** DELETE — body: { examId, lang?, id }. */
export async function DELETE(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as
    | { examId?: unknown; id?: unknown; lang?: unknown }
    | null;
  const examId = typeof body?.examId === "string" ? body.examId.trim() : "";
  const id = Number(body?.id);
  if (!/^[a-z0-9-]{2,64}$/.test(examId) || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const lang = typeof body?.lang === "string" && body.lang.toLowerCase() === "english" ? "english" : "bangla";
  await logAdminAction(admin, "exam-rules.delete", `exam=${examId} lang=${lang} id=${id}`, request);
  return NextResponse.json({ rules: await deleteExamRule(examId, id, lang) });
}
