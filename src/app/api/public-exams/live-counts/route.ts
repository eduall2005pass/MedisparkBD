import { fetchPublicExamCounts } from "@/lib/public-exams-server";
import { cachedJson } from "@/lib/api-cache";

export const dynamic = "force-dynamic";


export async function GET() {
  try {
    return cachedJson(await fetchPublicExamCounts(), "NO_CACHE");
  } catch {
    // A failed query is not an empty catalog; let clients keep their last counts.
    return cachedJson({ error: "Failed to load exam counts." }, "NO_CACHE", { status: 503 });
  }
}
