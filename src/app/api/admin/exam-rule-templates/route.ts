import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { logAdminAction } from "@/lib/administration";
import {
  deleteTemplateRule,
  normalizeTemplate,
  reorderTemplateRules,
  saveTemplateRule,
  seedTemplateIfEmpty,
} from "@/lib/exam-rule-templates";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

/** GET ?template=academic|medical|university — central rules of one type. */
export async function GET(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const template = normalizeTemplate(request.nextUrl.searchParams.get("template"));
  const rules = await seedTemplateIfEmpty(template);
  return NextResponse.json({ template, rules }, { headers: { "Cache-Control": "no-store" } });
}

/** POST — add/edit. Body: { template, id?, title, text }. */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    const rules = await saveTemplateRule(body);
    await logAdminAction(admin, "exam-rule-templates.save", `template=${String(body.template ?? "")} id=${String(body.id ?? "new")}`, request);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the rule." },
      { status: 400 },
    );
  }
}

/** PUT — reorder. Body: { template, order: [id, …] }. */
export async function PUT(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as { template?: unknown; order?: unknown } | null;
  const template = normalizeTemplate(body?.template);
  if (!Array.isArray(body?.order)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const ids = body!.order.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return NextResponse.json({ rules: await reorderTemplateRules(template, ids) });
}

/** DELETE — body: { template, id }. */
export async function DELETE(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return unauthorized();
  const body = (await request.json().catch(() => null)) as { template?: unknown; id?: unknown } | null;
  const template = normalizeTemplate(body?.template);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  await logAdminAction(admin, "exam-rule-templates.delete", `template=${template} id=${id}`, request);
  return NextResponse.json({ rules: await deleteTemplateRule(template, id) });
}
