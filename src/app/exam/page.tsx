import type { Metadata } from "next";
import ExamCategoryCards from "@/components/ExamCategoryCards";
import { fetchPublicExamCounts } from "@/lib/public-exams-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public Exam",
  description:
    "MediSpark public exams — model tests and mock exams for HSC academic and medical admission students.",
};

/**
 * Dedicated Public Exam landing page — opens from the Navbar / Hamburger
 * Menu. Shows the enrolled-exam shortcut above the 4 course-category cards;
 * public exam lists live inside each category page (/exam/category/<key>).
 */
export default async function ExamPage() {
  // A database outage must not render a misleading zero inventory or make
  // the landing page unavailable; the client retries the fresh count API.
  const initial = await fetchPublicExamCounts().catch((error: unknown) => {
    console.error("[exam] could not load category counts:", error);
    return null;
  });
  return (
    <main className="flex-1 bg-dark-950">
      <ExamCategoryCards initialCounts={initial?.counts} initialPracticeCounts={initial?.practiceCounts} />
    </main>
  );
}