import { NextResponse } from "next/server";
import {
  fetchFreshPublicExams,
  resolveExamCategoryId,
} from "@/lib/public-exams-server";
import { examCategories, type ExamCategory } from "@/lib/public-exams";
import { withCache } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

/**
 * Fresh (DB-direct, never Data-Cached) exam list for one category.
 * Powers the "এখনই রিফ্রেশ" button — bypasses the 10-min page cache.
 */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("category") as ExamCategory | null;
  if (!key || !examCategories.some((item) => item.key === key)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  try {
    const categoryId = await resolveExamCategoryId(key);
    if (!categoryId) {
      return NextResponse.json({ error: "Category not found." }, { status: 404 });
    }
    const exams = await fetchFreshPublicExams({ categoryId });
    return withCache(NextResponse.json({ exams }), "NO_CACHE");
  } catch {
    return NextResponse.json({ error: "Failed to load exams." }, { status: 500 });
  }
}
