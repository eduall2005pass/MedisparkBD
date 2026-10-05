import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermissionResult } from "@/lib/admin";
import { logAdminAction } from "@/lib/administration";
import { validateEnrolledExamCard } from "@/lib/enrolled-exam-card";
import { fetchEnrolledExamCard, resetEnrolledExamCard, saveEnrolledExamCard } from "@/lib/enrolled-exam-card-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function authorize(request: NextRequest) {
  return requireAnyPermissionResult(request, ["manageExams", "managePublicExam"]);
}

export async function GET(request: NextRequest) {
  const gate = await authorize(request);
  if (gate.status !== "ok") {
    return NextResponse.json({ error: "Unauthorized." }, { status: gate.status === "unauthenticated" ? 401 : 403, headers });
  }
  try {
    return NextResponse.json({ settings: await fetchEnrolledExamCard() }, { headers });
  } catch (error) {
    console.error("[admin/exams/enrolled-card] load failed:", error);
    return NextResponse.json({ error: "Could not load card settings." }, { status: 503, headers });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await authorize(request);
  if (gate.status !== "ok") {
    return NextResponse.json({ error: "Unauthorized." }, { status: gate.status === "unauthenticated" ? 401 : 403, headers });
  }
  let input;
  try {
    input = validateEnrolledExamCard(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid card settings." }, { status: 400, headers });
  }
  try {
    const settings = await saveEnrolledExamCard(input, gate.user.uid);
    await logAdminAction(gate.user, "settings.save", "my enrolled exams card", request);
    return NextResponse.json({ settings }, { headers });
  } catch (error) {
    console.error("[admin/exams/enrolled-card] save failed:", error);
    return NextResponse.json({ error: "Could not save card settings." }, { status: 500, headers });
  }
}

/** Delete the singleton override, restoring its documented default content. */
export async function DELETE(request: NextRequest) {
  const gate = await authorize(request);
  if (gate.status !== "ok") {
    return NextResponse.json({ error: "Unauthorized." }, { status: gate.status === "unauthenticated" ? 401 : 403, headers });
  }
  try {
    const settings = await resetEnrolledExamCard();
    await logAdminAction(gate.user, "settings.reset", "my enrolled exams card", request);
    return NextResponse.json({ settings }, { headers });
  } catch (error) {
    console.error("[admin/exams/enrolled-card] reset failed:", error);
    return NextResponse.json({ error: "Could not reset card settings." }, { status: 500, headers });
  }
}
