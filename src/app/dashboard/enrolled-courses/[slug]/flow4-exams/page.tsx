import type { Metadata } from "next";
import Flow4ExamView from "./Flow4ExamView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Course Exams | My Enrolled Courses",
  description: "Exams and quizzes from your enrolled course subjects.",
};

export default async function Flow4ExamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main className="flex-1 bg-dark-950">
      <Flow4ExamView slug={slug} />
    </main>
  );
}
