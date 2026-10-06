import type { Metadata } from "next";
import Link from "next/link";
import { AccessGate } from "@/components/auth/AccessGuard";

export const metadata: Metadata = {
  title: "Exam Results",
  description:
    "Choose your Public Exam results or Course Exam results — MediSpark dashboard.",
};

const CARDS = [
  {
    href: "/dashboard/exam-result/public",
    title: "Public Exam",
    description: "Results of the public exams you have attempted.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6 sm:h-7 sm:w-7"
        aria-hidden="true"
      >
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
        <path d="M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/dashboard/exam-result/course",
    title: "Course Exam",
    description: "Results of the course exams from your enrolled courses.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6 sm:h-7 sm:w-7"
        aria-hidden="true"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </svg>
    ),
  },
];

/**
 * Main Exam Result selection page — shows exactly two clickable cards
 * (Public Exam / Course Exam). Never shows a result list itself; each card
 * opens its own dedicated result page.
 */
export default function ExamResultPage() {
  return (
    <main className="flex-1 bg-dark-950">
      <AccessGate
        requirement="registered"
        loadingLabel="Loading your exam results..."
      >
        <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group relative flex flex-col items-center rounded-2xl border border-ink/10 bg-dark-900 p-5 text-center shadow-lg shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-primary-600/60 hover:shadow-primary-900/30 active:scale-[0.98] sm:p-6"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600/15 text-primary-500 transition group-hover:bg-primary-600 group-hover:text-heading group-hover:shadow-md group-hover:shadow-primary-900/50 sm:h-14 sm:w-14">
                  {card.icon}
                </span>
                <span className="mt-4 block text-sm font-bold leading-snug text-heading transition group-hover:text-primary-400 sm:text-base">
                  {card.title}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-neutral-400 sm:text-sm">
                  {card.description}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </AccessGate>
    </main>
  );
}
