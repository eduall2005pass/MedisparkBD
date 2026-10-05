import { NextRequest, NextResponse } from "next/server";
import { getFirebaseUser } from "@/lib/auth-api";
import { isMysqlConfigured } from "@/lib/mysql";
import { resolveDirectExamRoute } from "@/lib/enrolled-exams";
import { getMyEnrolledExamCourse } from "@/lib/enrolled-exams-server";
import { fetchFreshCourseExamShortcuts } from "@/lib/enrolled-exams-course-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const user = await getFirebaseUser(request);
    if (!user || !isMysqlConfigured) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    }
    const slug = request.nextUrl.searchParams.get("course") ?? "";
    if (!slug) return NextResponse.json({ error: "Missing course." }, { status: 400, headers });
    const course = await getMyEnrolledExamCourse(user.uid, slug);
    if (!course) {
      return NextResponse.json(
        { error: "This course is unavailable or you are not actively enrolled." },
        { status: 403, headers },
      );
    }
    // A bookmarked legacy section may now belong to another layout. Return
    // fresh routing metadata without loading the wrong content model.
    const exams = course.direct_exam_route_url === resolveDirectExamRoute(slug, "flow-1")
      ? await fetchFreshCourseExamShortcuts(slug)
      : [];
    return NextResponse.json({ course, exams }, { headers });
  } catch (error) {
    console.error("[api/my/course-exams] failed:", error);
    return NextResponse.json({ error: "Could not load your course exams." }, { status: 500, headers });
  }
}
