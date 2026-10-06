import type { Metadata } from "next";
import { AccessGate } from "@/components/auth/AccessGuard";
import ExamResultTypeView from "@/components/dashboard/ExamResultTypeView";

export const metadata: Metadata = {
  title: "Course Exam Results",
  description:
    "Results of the course exams you have attempted through your enrolled courses on MediSpark.",
};

export default function CourseExamResultPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <AccessGate
        requirement="registered"
        loadingLabel="Loading your course exam results..."
      >
        <ExamResultTypeView kind="course" />
      </AccessGate>
    </main>
  );
}
