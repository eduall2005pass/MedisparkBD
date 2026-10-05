import type { Metadata } from "next";
import EnrolledExamCourseSelection from "@/components/EnrolledExamCourseSelection";

export const metadata: Metadata = {
  title: "My Enrolled Exams",
  description: "Choose an enrolled course to go directly to its exams.",
};

export default function EnrolledExamsPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <EnrolledExamCourseSelection />
    </main>
  );
}
