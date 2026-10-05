import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { isMysqlConfigured } from "@/lib/mysql";
import { getMyEnrolledExams } from "@/lib/enrolled-exams-server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const user = await getFirebaseUser(request);
    if (!user || !isMysqlConfigured) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    }
    const enrolled_courses = await getMyEnrolledExams(user.uid);
    return NextResponse.json({ enrolled_courses }, { headers });
  } catch (error) {
    console.error("[api/my/enrolled-exams] failed:", error);
    return NextResponse.json(
      { error: "Could not load your enrolled exams." },
      { status: 500, headers },
    );
  }
}
