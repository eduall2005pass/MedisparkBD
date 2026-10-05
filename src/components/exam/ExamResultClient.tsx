"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AccessLoading, AccessMessage } from "@/components/auth/AccessGuard";
import { answerIndexToLetter } from "@/lib/paste-mcq-parser";
import { examResultApiPath } from "@/lib/exam-result-language";
import {
  cacheExamResult,
  getCachedExamResult,
} from "@/lib/offline-exam-cache";

type ScriptQuestion = {
  questionId: number;
  question: string;
  options: string[];
  marks: number;
  chosenIndex: number | null;
  /** NULL = unknown answer — rendered as "—", never defaulted to A. */
  correctIndex: number | null;
  obtained: number;
  explanation: string | null;
  questionImage?: string | null;
  contentFallback?: "base" | "unavailable" | null;
};

type ResultScript = {
  examName: string;
  score: number;
  totalMarks: number;
  submittedAt: string | null;
  timeTakenSeconds: number | null;
  meritPosition: number | null;
  highestMark: number | null;
  negativeDeduction: number;
  timerPenalty: number;
  secondTimer: boolean;
  questionVersion?: "bangla" | "english" | null;
  questions: ScriptQuestion[];
};

export default function ExamResultClient({
  examId,
  examName,
  questionVersion = null,
}: {
  examId: string;
  examName: string;
  questionVersion?: "bangla" | "english" | null;
}) {
  const { user, profile, authLoading, profileLoading } = useAuth();
  const [script, setScript] = useState<ResultScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  // True while the shown result comes from the offline local cache.
  const [offlineCached, setOfflineCached] = useState(false);

  useEffect(() => {
    if (authLoading || profileLoading || !user) return;
    let cancelled = false;
    const uid = user.uid;
    async function load() {
      setLoading(true);
      setError(null);
      setOfflineCached(false);
      let allowCachedResult = true;
      try {
        const token = await user!.getIdToken();
        const res = await fetch(examResultApiPath(examId, questionVersion), {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        });
        if (!res.ok) {
          allowCachedResult = res.status >= 500;
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "No submitted result found for this exam yet.");
        }
        const data = (await res.json()) as ResultScript;
        // Participated exam → mirror the fresh result locally for offline viewing.
        cacheExamResult(uid, examId, data);
        if (!cancelled) setScript(data);
      } catch (err) {
        // Offline (or fetch failed): fall back to the locally cached result
        // of this participated exam so it stays viewable without data.
        const cached = getCachedExamResult<ResultScript>(uid, examId);
        if (!cancelled && allowCachedResult && cached && (!questionVersion || cached.questionVersion === questionVersion)) {
          setScript(cached);
          setOfflineCached(true);
        } else if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load result. Please retry.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    // Network is back → re-fetch dynamically so fresh data replaces the cache.
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [authLoading, profileLoading, user, examId, questionVersion]);

  if (authLoading || profileLoading) return <AccessLoading label="Loading result…" />;
  if (!user) {
    return (
      <AccessMessage
        title="Login Required"
        message="You must be logged in to view your exam result."
        actionLabel="Login"
        actionHref={`/login?next=${encodeURIComponent(`/exam/${examId}/result`)}`}
      />
    );
  }
  if (!profile) {
    return (
      <AccessMessage
        title="Registration Required"
        message="Complete your student registration to view results."
        actionLabel="Complete Registration"
        actionHref="/register"
      />
    );
  }
  if (loading) return <AccessLoading label="Loading result…" />;
  if (error || !script) {
    return (
      <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
        <p className="font-semibold text-yellow-300">{error ?? "No result found."}</p>
        <Link
          href={`/exam/${encodeURIComponent(examId)}`}
          className="mt-4 inline-block rounded-xl bg-primary-600 px-5 py-2 text-sm font-bold text-white hover:bg-primary-700"
        >
          Back to Exam
        </Link>
      </div>
    );
  }

  const totalQuestions = script.questions.length;
  const correctCount = script.questions.filter((q) => q.chosenIndex !== null && q.chosenIndex === q.correctIndex).length;
  const wrongCount = script.questions.filter((q) => q.chosenIndex !== null && q.chosenIndex !== q.correctIndex).length;
  const unanswered = totalQuestions - correctCount - wrongCount;
  const correctMarks = script.questions
    .filter((q) => q.chosenIndex !== null && q.chosenIndex === q.correctIndex)
    .reduce((s, q) => s + q.marks, 0);

  if (showSheet) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-heading">Answer Sheet</h3>
            <p className="text-xs text-neutral-400">
              {script.examName}{script.questionVersion ? ` · ${script.questionVersion === "english" ? "English" : "Bangla"} Version` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSheet(false)}
            className="rounded-xl border border-ink/10 bg-dark-850 px-4 py-2 text-sm font-bold text-neutral-300 transition hover:text-heading"
          >
            ← Back to Result
          </button>
        </div>
        <ol className="space-y-4">
          {script.questions.map((item, index) => {
            // An unknown correct answer (null) can never match — the old
            // `65 + null` fallback rendered it as "A"; now it shows "—".
            const isCorrect =
              item.chosenIndex !== null &&
              item.correctIndex !== null &&
              item.chosenIndex === item.correctIndex;
            // Per Spec §17/18: negative marking is shown only as a total on the Rules page/result summary, not beside each question.
            const status = item.chosenIndex === null ? "Unanswered" : isCorrect ? "Correct" : "Wrong";
            return (
              <li
                key={item.questionId}
                className={`rounded-2xl border p-4 sm:p-5 ${
                  item.chosenIndex === null
                    ? "border-ink/10 bg-dark-900"
                    : isCorrect
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold leading-relaxed text-heading sm:text-base">
                    {index + 1}. {item.question}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                      item.chosenIndex === null
                        ? "bg-neutral-500/15 text-neutral-400"
                        : isCorrect
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {status}
                  </span>
                </div>
                {item.contentFallback === "base" && (
                  <p className="mt-2 text-xs text-amber-300">Showing original content; the translation for this version is unavailable.</p>
                )}
                {item.questionImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.questionImage}
                    alt={`Question ${index + 1} image`}
                    className="mt-3 max-h-72 w-full rounded-xl border border-ink/10 object-contain bg-dark-950"
                  />
                ) : null}
                <div className="mt-3 space-y-2">
                  {item.options.map((option, optionIndex) => {
                    const chosen = item.chosenIndex === optionIndex;
                    const correct = item.correctIndex === optionIndex;
                    return (
                      <div
                        key={optionIndex}
                        className={`result-option flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold ${
                          correct
                            ? "result-option--correct border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                            : chosen
                              ? "result-option--chosen border-red-500/50 bg-red-500/10 text-red-200"
                              : "border-ink/10 bg-dark-850 text-neutral-300"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                            correct ? "bg-emerald-500 text-white" : chosen ? "bg-red-500 text-white" : "bg-ink/10 text-neutral-400"
                          }`}
                        >
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        <span className="min-w-0 break-words">{option}</span>
                        {correct && <span className="ml-auto shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-emerald-300">Correct Answer</span>}
                        {chosen && !correct && <span className="ml-auto shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-red-300">Your Answer</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-semibold">
                  <span className="text-neutral-400">
                    Marks: <span className="text-heading">{item.marks}</span>
                    <span className="ml-2 text-neutral-400">
                      Obtained: <span className={isCorrect ? "text-emerald-400" : "text-neutral-400"}>{isCorrect ? `+${item.marks}` : "0"}</span>
                    </span>
                  </span>
                  <span className="text-neutral-400">
                    Your Answer: <span className="text-heading">{item.chosenIndex == null ? "Not Answered" : String.fromCharCode(65 + item.chosenIndex)}</span>
                  </span>
                  <span className="text-neutral-400">
                    Correct: <span className="text-heading">{answerIndexToLetter(item.correctIndex) ?? "—"}</span>
                  </span>
                </div>
                {item.explanation && (
                  <div className="mt-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-200">
                    <span className="font-extrabold">Explanation: </span>
                    {item.explanation}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary-600/30 bg-primary-600/10 p-4 sm:p-8">
      <h3 className="text-center text-lg font-extrabold text-heading">Exam Result</h3>
      <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-ink/10 bg-dark-900 p-5 sm:p-6">
        <div className="text-center">
          <div className="rounded-xl border border-ink/10 bg-dark-850 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Exam Name</p>
            <p className="text-sm font-bold text-heading">{script.examName || examName}</p>
          </div>
        </div>

        <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Correct</p>
            <p className="mt-1 text-lg font-extrabold text-emerald-300">{correctCount}</p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-400">Wrong</p>
            <p className="mt-1 text-lg font-extrabold text-red-300">{wrongCount}</p>
          </div>
          <div className="rounded-xl border border-ink/10 bg-dark-850 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Unanswered</p>
            <p className="mt-1 text-lg font-extrabold text-neutral-300">{unanswered}</p>
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Final Marks</p>
          <p className="text-5xl font-extrabold text-primary-300">
            {script.score}
            <span className="text-2xl text-neutral-400"> / {script.totalMarks}</span>
          </p>
        </div>

        <ul className="mt-4 grid gap-2 text-left text-sm">
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Correct Marks</span>
            <span className="font-extrabold text-emerald-300">{correctMarks} / {script.totalMarks}</span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Negative Marking</span>
            <span className="font-extrabold text-red-300">{script.negativeDeduction > 0 ? `−${script.negativeDeduction}` : "0"}</span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Second Timer Penalty</span>
            <span className="font-extrabold text-red-300">{script.secondTimer ? `−${script.timerPenalty}` : "0"}</span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Merit Position / Rank</span>
            <span className="font-extrabold text-primary-300">{script.meritPosition != null ? `#${script.meritPosition}` : "—"}</span>
          </li>
          <li className="flex items-center justify-between rounded-xl border border-ink/10 bg-dark-850 px-4 py-2.5">
            <span className="font-semibold text-neutral-400">Highest Mark</span>
            <span className="font-extrabold text-heading">{script.highestMark != null ? script.highestMark : "—"}</span>
          </li>
        </ul>
      </div>

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => setShowSheet(true)}
          className="w-full rounded-xl bg-primary-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-500 active:scale-[0.98] sm:w-auto"
        >
          View Answer Sheet
        </button>
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
