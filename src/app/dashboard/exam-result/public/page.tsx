import type { Metadata } from "next";
import { AccessGate } from "@/components/auth/AccessGuard";
import ExamResultTypeView from "@/components/dashboard/ExamResultTypeView";

export const metadata: Metadata = {
  title: "Public Exam Results",
  description: "Results of the public exams you have attempted on MediSpark.",
};

export default function PublicExamResultPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <AccessGate
        requirement="registered"
        loadingLabel="Loading your public exam results..."
      >
        <ExamResultTypeView kind="public" />
      </AccessGate>
    </main>
  );
}
