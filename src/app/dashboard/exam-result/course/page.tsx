import type { Metadata } from "next";
import { AccessGate } from "@/components/auth/AccessGuard";
import AdminResultGate from "@/components/admin/AdminResultGate";
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
        <AdminResultGate>
          <ExamResultTypeView kind="course" />
        </AdminResultGate>
      </AccessGate>
    </main>
  );
}
