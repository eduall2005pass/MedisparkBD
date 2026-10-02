import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicExamCategoryView from "@/components/PublicExamCategoryView";
import {
  examCategories,
  batches,
  type ExamCategory,
} from "@/lib/public-exams";
import {
  fetchPublicExams,
  resolveExamCategoryId,
} from "@/lib/public-exams-server";



export const dynamic = "force-dynamic";

const categoryMeta: Record<
  ExamCategory,
  { description: string }
> = {
  "ssc-academic": {
    description:
      "SSC academic model tests — live, upcoming and previous exams in one place.",
  },
  "hsc-academic": {
    description:
      "HSC academic model tests — live, upcoming and previous exams in one place.",
  },
  "medical-admission": {
    description:
      "Medical admission mock exams — live, upcoming and previous in one place.",
  },
  "varsity-admission": {
    description:
      "University admission practice exams — live, upcoming and previous in one place.",
  },
};

type CategoryPageProps = {
  params: Promise<{ category: string }>;
};

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  const valid = examCategories.find((item) => item.key === category);
  if (!valid) return { title: "Exam Category Not Found" };
  return { title: valid.label, description: categoryMeta[valid.key].description };
}

export default async function ExamCategoryPage({ params }: CategoryPageProps) {
  const { category } = await params;
  const valid = examCategories.find((item) => item.key === category);
  if (!valid) {
    notFound();
  }

  // Resolve the URL key to its real Course Control category id, then fetch
  // ONLY that category's exams (SQL WHERE category_id = ?). Admin-created
  // exams appear here automatically — no heuristic matching.
  const categoryId = await resolveExamCategoryId(valid.key);
  if (!categoryId) notFound();
  const exams = await fetchPublicExams({ categoryId });

  return (
    <main className="flex-1 bg-dark-950">
      {/* Category → Live Exam | Practice Exam (default: Live). */}
      <PublicExamCategoryView
        key={valid.key}
        exams={exams}
        batches={batches}
        categoryKey={valid.key}
        serverNowMs={Date.now()}
      />
    </main>
  );
}