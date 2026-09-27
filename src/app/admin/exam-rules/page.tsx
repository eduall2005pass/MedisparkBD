import type { Metadata } from "next";
import ExamRuleTemplatesManager from "@/components/admin/ExamRuleTemplatesManager";

export const metadata: Metadata = {
  title: "Exam Rules — MediSpark Admin",
  description: "Manage Academic, Medical and Varsity exam rules.",
  robots: { index: false, follow: false },
};

export default function AdminExamRulesPage() {
  return <ExamRuleTemplatesManager />;
}
