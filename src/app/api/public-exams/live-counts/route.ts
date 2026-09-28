import { fetchLiveExamCounts, fetchPracticeExamCounts } from "@/lib/public-exams-server";
import { cachedJson } from "@/lib/api-cache";

export const dynamic = "force-dynamic";

const ZERO = {
  "ssc-academic": 0,
  "hsc-academic": 0,
  "medical-admission": 0,
  "varsity-admission": 0,
};

export async function GET() {
  try {
    const [counts, practiceCounts] = await Promise.all([
      fetchLiveExamCounts(),
      fetchPracticeExamCounts(),
    ]);
    return cachedJson({ counts, practiceCounts }, "API_MEDIUM");
  } catch {
    return cachedJson(
      {
        counts: { ...ZERO },
        practiceCounts: { ...ZERO },
      },
      "API_MEDIUM"
    );
  }
}
