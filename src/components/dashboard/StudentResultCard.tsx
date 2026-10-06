"use client";

import Link from "next/link";
import type { StudentResultCardData } from "@/lib/my-exam-results";

/**
 * Simplified student Exam Result Card — the same required structure used
 * across result surfaces: Exam Name → Correct/Wrong/Unanswered → Final
 * Marks → Correct Marks / Negative Marking / Second Timer Penalty /
 * Merit Position / Rank / Highest Mark → View Answer Sheet + Go to
 * Dashboard. No removed fields (Total Questions, Total Marks box, Time
 * Taken, Submission Status, Percentage, duplicate headings) are shown.
 */
export default function StudentResultCard({
  result,
}: {
  result: StudentResultCardData;
}) {
  return (
    <div className="rounded-2xl border border-primary-600/30 bg-primary-600/10 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl rounded-2xl border border-ink/10 bg-dark-900 p-5 sm:p-6">
        {/* Exam Name */}
        <div className="text-center">
          <div className="rounded-xl border border-ink/10 bg-dark-850 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">
              Exam Name
            </p>
            <p className="text-sm font-bold text-heading">{result.examName}</p>
          </div>
        </div>

        {/* Answer Summary */}
        <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">
              Correct
            </p>
            <p className="mt-1 text-lg font-extrabold text-emerald-300">
              {result.correctCount}
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-400">
              Wrong
            </p>
            <p className="mt-1 text-lg font-extrabold text-red-300">
              {result.wrongCount}
            </p>
          </div>
          <div className="rounded-xl border border-ink/10 bg-dark-850 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
              Unanswered
            </p>
            <p className="mt-1 text-lg font-extrabold text-neutral-300">
              {result.unansweredCount}
            </p>
          </div>
        </div>

        {/* Final Marks */}
        <div className="mt-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Final Marks
          </p>
          <p className="text-5xl font-extrabold text-primary-300">
            {result.score}
            <span className="text-2xl text-neutral-400">
              {" "}
              / {result.totalMarks}
            </span>
          </p>
        </div>

        {/* Additional Result Information */}
        <ul className="mt-4 grid gap-2 text-left text-sm">
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Correct Marks</span>
            <span className="font-extrabold text-emerald-300">
              {result.correctMarks} / {result.totalMarks}
            </span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">
              Negative Marking
            </span>
            <span className="font-extrabold text-red-300">
              {result.negativeDeduction > 0 ? `−${result.negativeDeduction}` : "0"}
            </span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">
              Second Timer Penalty
            </span>
            <span className="font-extrabold text-red-300">
              {result.secondTimer ? `−${result.timerPenalty}` : "0"}
            </span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">
              Merit Position / Rank
            </span>
            <span className="font-extrabold text-primary-300">
              {result.meritPosition != null ? `#${result.meritPosition}` : "—"}
            </span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Highest Mark</span>
            <span className="font-extrabold text-heading">
              {result.highestMark != null ? result.highestMark : "—"}
            </span>
          </li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href={`/dashboard/exam-result/${encodeURIComponent(result.examId)}`}
          className="w-full rounded-xl bg-primary-600 px-6 py-3 text-center text-sm font-extrabold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-500 active:scale-[0.98] sm:w-auto"
        >
          View Answer Sheet
        </Link>
        <Link
          href="/dashboard"
          className="w-full rounded-xl border border-ink/10 bg-dark-850 px-6 py-3 text-center text-sm font-bold text-neutral-300 transition hover:text-heading sm:w-auto"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
