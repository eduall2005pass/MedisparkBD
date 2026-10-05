import { NextResponse } from "next/server";
import { fetchEnrolledExamCard } from "@/lib/enrolled-exam-card-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const settings = await fetchEnrolledExamCard();
    return NextResponse.json({ settings }, { headers });
  } catch (error) {
    console.error("[public-exams/enrolled-card] failed:", error);
    return NextResponse.json({ error: "Could not load enrolled exam card settings." }, { status: 503, headers });
  }
}
