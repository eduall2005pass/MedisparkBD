import type { Metadata } from "next";
import CourseExamShortcutView from "./CourseExamShortcutView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Course Exams | My Enrolled Courses",
  description: "All published exams assigned to your enrolled course.",
};

export default async function CourseExamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main className="flex-1 bg-dark-950">
      <CourseExamShortcutView slug={slug} />
    </main>
  );
}
