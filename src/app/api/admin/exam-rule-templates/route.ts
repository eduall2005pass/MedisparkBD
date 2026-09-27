import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { logAdminAction } from "@/lib/administration";
import {
  deleteTemplateRule,
  normalizeLang,
  normalizeTemplate,
  reorderTemplateRules,
  saveTemplateRule,
  seedTemplateIfEmpty,
} from "@/lib/exam-rule-templates";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

/** GET ?template=academic|medical|university&lang=bangla|english. */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const template = normalizeTemplate(request.nextUrl.searchParams.get("template"));
  const lang = normalizeLang(request.nextUrl.searchParams.get("lang"));
  const rules = await seedTemplateIfEmpty(template, lang);
  return NextResponse.json({ template, lang, rules }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — add/edit. Body: { template, lang?, id?, title, text }. */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    const rules = await saveTemplateRule(body);
    await logAdminAction(admin, "exam-rule-templates.save", `template=${String(body.template ?? "")} lang=${String(body.lang ?? "bangla")} id=${String(body.id ?? "new")}`, request);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the rule." },
      { status: 400 },
    );
  }
}

/** PUT — reorder. Body: { template, lang?, order: [id, …] }. */
export async function PUT(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as { template?: unknown; order?: unknown; lang?: unknown } | null;
  const template = normalizeTemplate(body?.template);
  const lang = normalizeLang(body?.lang);
  if (!Array.isArray(body?.order)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const ids = body!.order.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return NextResponse.json({ rules: await reorderTemplateRules(template, lang, ids) });
}

/** DELETE — body: { template, lang?, id }. */
export async function DELETE(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as { template?: unknown; id?: unknown; lang?: unknown } | null;
  const template = normalizeTemplate(body?.template);
  const lang = normalizeLang(body?.lang);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  await logAdminAction(admin, "exam-rule-templates.delete", `template=${template} lang=${lang} id=${id}`, request);
  return NextResponse.json({ rules: await deleteTemplateRule(template, lang, id) });
}
