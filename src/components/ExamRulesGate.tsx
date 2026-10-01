"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type Rule = { id: number | null; title: string; text: string };

/**
 * Rules gate for ONE specific exam. Rules are loaded dynamically from the
 * database (Admin → Public Exam Control → Rules). [Agree & Continue] stays
 * disabled until the student ticks the agreement checkbox — only then the
 * actual attempt begins.
 */
export default function ExamRulesGate({ examId }: { examId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesEn, setRulesEn] = useState<Rule[]>([]);
  // Rules display language — follows the chosen Question Version (Bangla
  // version → বাংলা rules, English version → English rules). Defaults to
  // Bangla until the student picks a version.
  const [rulesLang, setRulesLang] = useState<"bangla" | "english">("bangla");
  const [agreed, setAgreed] = useState(false);
  const [timerType, setTimerType] = useState<"first" | "second" | null>(null);
  const [secondTimerEnabled, setSecondTimerEnabled] = useState(false);
  const [secondTimerDeduction, setSecondTimerDeduction] = useState<number>(3);
  const [alreadyAttempted, setAlreadyAttempted] = useState(false);
  const [canPracticeRetake, setCanPracticeRetake] = useState(false);
  // Question Version — student must pick Bangla or English before starting.
  // Locked after Agree & Continue; cannot be switched during the exam.
  const [questionVersion, setQuestionVersion] = useState<"bangla" | "english" | null>(null);
  const [versionCoverage, setVersionCoverage] = useState<Record<string, number> | null>(null);
  const [versionTotal, setVersionTotal] = useState<number | null>(null);

  // Rules need no login — load them immediately on mount so the page never
  // waits for Firebase auth / ID token before showing content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/exams/${examId}/rules`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as {
          rules?: Rule[];
          rulesEn?: Rule[];
          secondTimerEnabled?: boolean;
          secondTimerDeduction?: number;
          versions?: { totalSlots?: number; coverage?: Record<string, number> } | null;
        } | null;
        if (!response.ok || !data) {
          throw new Error("Failed to load rules.");
        }
        if (cancelled) return;
        setRules(data.rules ?? []);
        setRulesEn(data.rulesEn ?? data.rules ?? []);
        setVersionCoverage(data.versions?.coverage ?? null);
        setVersionTotal(typeof data.versions?.totalSlots === "number" ? data.versions.totalSlots : null);
        setSecondTimerEnabled(Boolean(data.secondTimerEnabled));
        setSecondTimerDeduction(
          typeof data.secondTimerDeduction === "number" && Number.isFinite(data.secondTimerDeduction) && data.secondTimerDeduction > 0
            ? Number(data.secondTimerDeduction)
            : 3,
        );
      } catch {
        if (!cancelled) setError("Something went wrong.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  // Strict one-attempt check runs separately once the user is known — it
  // never blocks the rules list above.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const priorRes = await fetch(`/api/exams/${encodeURIComponent(examId)}/prior-attempt`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        });
        const priorData = (await priorRes.json().catch(() => null)) as { hasPriorAttempt?: boolean; canPracticeRetake?: boolean } | null;
        if (!cancelled && priorRes.ok && priorData?.hasPriorAttempt) {
          setAlreadyAttempted(true);
          setCanPracticeRetake(Boolean(priorData?.canPracticeRetake));
        }
      } catch {
        // ignore prior check failure
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, user]);

  function retry() {
    setError(null);
    setLoading(true);
    void fetch(`/api/exams/${examId}/rules`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          rules?: Rule[];
          rulesEn?: Rule[];
          secondTimerEnabled?: boolean;
          secondTimerDeduction?: number;
          versions?: { totalSlots?: number; coverage?: Record<string, number> } | null;
        } | null;
        if (!response.ok || !data) throw new Error("Failed to load rules.");
        setRules(data.rules ?? []);
        setRulesEn(data.rulesEn ?? data.rules ?? []);
        setVersionCoverage(data.versions?.coverage ?? null);
        setVersionTotal(typeof data.versions?.totalSlots === "number" ? data.versions.totalSlots : null);
        setSecondTimerEnabled(Boolean(data.secondTimerEnabled));
        setSecondTimerDeduction(
          typeof data.secondTimerDeduction === "number" && Number.isFinite(data.secondTimerDeduction) && data.secondTimerDeduction > 0
            ? Number(data.secondTimerDeduction)
            : 3,
        );
      })
      .catch(() => setError("Something went wrong."))
      .finally(() => setLoading(false));
  }

  function versionCount(version: "bangla" | "english"): string | null {
    if (versionCoverage === null || versionTotal === null) return null;
    const filled = Math.max(
      versionCoverage[`${version}:A`] ?? 0,
      versionCoverage[`${version}:B`] ?? 0,
    );
    return `${filled}/${versionTotal} questions ready`;
  }

  function beginHref(): string {
    const timer = secondTimerEnabled ? (timerType ?? "first") : "first";
    const version = questionVersion ?? "bangla";
    return `/exam/${examId}?begin=1&timer=${timer}&version=${version}`;
  }

  // Rules shown in the version language (English falls back to Bangla when
  // the admin hasn't written English rules yet).
  const shown = rulesLang === "english" ? (rulesEn.length > 0 ? rulesEn : rules) : rules;

  function renderLangToggle() {
    return (
      <div className="mt-4 flex gap-2">
        {(["bangla", "english"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setRulesLang(l)}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold transition ${
              rulesLang === l
                ? "border-primary-500/60 bg-primary-600/15 text-primary-200"
                : "border-ink/10 bg-dark-850 text-neutral-400 hover:border-primary-500/30"
            }`}
          >
            {l === "bangla" ? "বাংলা নিয়ম" : "English Rules"}
          </button>
        ))}
      </div>
    );
  }

  function renderVersionSelector() {
    return (
      <div className="mt-6 rounded-2xl border border-primary-600/30 bg-dark-850 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-heading">
          Question Version
          <span className="rounded-full bg-primary-600/15 px-2.5 py-0.5 text-[10px] font-bold text-primary-300">Required</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          Choose the language version for this exam. Your version is locked after you start — it cannot be changed during the exam.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([
            { key: "bangla", title: "Bangla Version", hint: "Bangla / English / mixed questions" },
            { key: "english", title: "English Version", hint: "English questions" },
          ] as const).map((option) => {
            const selected = questionVersion === option.key;
            const count = versionCount(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => { setQuestionVersion(option.key); setRulesLang(option.key); }}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
                  selected
                    ? "border-primary-500/60 bg-primary-600/10 ring-1 ring-primary-500/30"
                    : "border-ink/10 bg-dark-900 hover:border-primary-500/30"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                    selected ? "border-primary-500 bg-primary-600 text-white" : "border-ink/20 bg-dark-850 text-neutral-500"
                  }`}
                >
                  {selected ? "●" : "○"}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-heading">{option.title}</p>
                  <p className="text-xs text-neutral-400">
                    {option.hint}
                    {count ? <span className="ml-1 font-semibold text-neutral-500">· {count}</span> : null}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {!questionVersion && (
          <p className="mt-2 text-xs font-semibold text-amber-400">Please select a Question Version to continue.</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-ink/10 bg-dark-900 p-5 shadow-lg shadow-black/20 sm:p-6">
      <h2 className="text-lg font-extrabold text-heading">Exam Rules</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Read the rules carefully before starting this exam.
      </p>

      {loading && (
        <div className="mt-6 flex flex-col items-center gap-3 py-8">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          <p className="text-sm text-neutral-400">Loading rules…</p>
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 py-8 text-center">
          <p className="text-sm font-semibold text-red-400">{error}</p>
          <button
            type="button"
            onClick={() => void retry()}
            className="mt-4 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700"
          >
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && alreadyAttempted && (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
          <p className="font-extrabold text-emerald-300">You have already appeared in this exam.</p>
          {canPracticeRetake ? (
            <p className="mx-auto mt-2 max-w-md rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold leading-relaxed text-violet-300">
              Practice mode — যতবার খুশি আবার দিতে পারবে। Practice attempt leaderboard বা merit
              position-এ কোনো effect ফেলবে না।
            </p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-neutral-400">
              You have already appeared in this exam. You cannot start it again — view your existing result.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
            {canPracticeRetake && (
              <button
                type="button"
                onClick={() => {
                  setAgreed(false);
                  setAlreadyAttempted(false);
                }}
                className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-700 active:scale-[0.98]"
              >
                Practice Again →
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push(`/exam/${examId}/result`)}
              className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-700 active:scale-[0.98]"
            >
              View Result →
            </button>
          </div>
        </div>
      )}

      {!loading && !error && !alreadyAttempted && rules.length === 0 && rulesEn.length === 0 && (
        <>
          <p className="mt-6 rounded-xl border border-dashed border-ink/15 bg-dark-950/60 p-6 text-center text-sm text-neutral-400">
            No Rules Added.
          </p>
          {secondTimerEnabled && (
            <div className="mt-6 rounded-2xl border border-primary-600/30 bg-dark-850 p-4 sm:p-5">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-heading">
                Timer Type
                <span className="rounded-full bg-primary-600/15 px-2.5 py-0.5 text-[10px] font-bold text-primary-300">Required</span>
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                First Timer: No timer penalty will be deducted. Second Timer:{" "}
                <span className="font-bold text-red-300">{secondTimerDeduction} marks</span> will be deducted from the final score.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTimerType("first")}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
                    timerType === "first"
                      ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : "border-ink/10 bg-dark-900 hover:border-emerald-500/30"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                      timerType === "first" ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink/20 bg-dark-850 text-neutral-500"
                    }`}
                  >
                    {timerType === "first" ? "●" : "○"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-heading">First Timer</p>
                    <p className="text-xs text-neutral-400">No penalty.</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTimerType("second")}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
                    timerType === "second"
                      ? "border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30"
                      : "border-ink/10 bg-dark-900 hover:border-red-500/30"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                      timerType === "second" ? "border-red-500 bg-red-500 text-white" : "border-ink/20 bg-dark-850 text-neutral-500"
                    }`}
                  >
                    {timerType === "second" ? "●" : "○"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-heading">Second Timer</p>
                    <p className="text-xs text-neutral-400">
                      <span className="font-bold text-red-300">−{secondTimerDeduction} marks</span> penalty.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}
          {renderVersionSelector()}
          <label
            htmlFor="rules-agree-empty"
            className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-primary-500/30 bg-primary-600/5 p-4 transition hover:bg-primary-600/10"
          >
            <input
              id="rules-agree-empty"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary-500,#e50914)]"
            />
            <span className="text-sm font-semibold text-heading">I have read and agree to the exam rules</span>
          </label>
<div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={!agreed || (secondTimerEnabled && !timerType) || !questionVersion}
              onClick={() => {
                router.push(beginHref());
              }}
              className="w-full sm:w-auto rounded-xl bg-primary-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:border disabled:border-ink/10 disabled:bg-dark-800 disabled:text-neutral-500 disabled:shadow-none"
            >
              Agree & Continue →
            </button>
          </div>
        </>
      )}

      {!loading && !error && !alreadyAttempted && shown.length > 0 && (
        <>
          {renderLangToggle()}
          <ul className="mt-4 space-y-3">
            {shown.map((rule, index) => (
              <li
                key={rule.id ?? `rule-${index}`}
                className="flex gap-3 rounded-xl border border-ink/10 bg-dark-850 p-3.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-600/15 text-xs font-extrabold text-primary-300">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  {rule.title && (
                    <p className="text-sm font-bold text-heading">{rule.title}</p>
                  )}
                  <p className={`text-xs leading-relaxed text-neutral-400 sm:text-sm ${rule.title ? "mt-0.5" : ""}`}>
                    {rule.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Timer Type — required when Second Timer Penalty is enabled */}
          {secondTimerEnabled && (
            <div className="mt-6 rounded-2xl border border-primary-600/30 bg-dark-850 p-4 sm:p-5">
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-heading">
                Timer Type
                <span className="rounded-full bg-primary-600/15 px-2.5 py-0.5 text-[10px] font-bold text-primary-300">Required</span>
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                First Timer: No timer penalty will be deducted. Second Timer:{" "}
                <span className="font-bold text-red-300">{secondTimerDeduction} marks</span> will be deducted from the final score.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTimerType("first")}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
                    timerType === "first"
                      ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : "border-ink/10 bg-dark-900 hover:border-emerald-500/30"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                      timerType === "first" ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink/20 bg-dark-850 text-neutral-500"
                    }`}
                  >
                    {timerType === "first" ? "●" : "○"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-heading">First Timer</p>
                    <p className="text-xs text-neutral-400">No penalty.</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setTimerType("second")}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
                    timerType === "second"
                      ? "border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30"
                      : "border-ink/10 bg-dark-900 hover:border-red-500/30"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-extrabold ${
                      timerType === "second" ? "border-red-500 bg-red-500 text-white" : "border-ink/20 bg-dark-850 text-neutral-500"
                    }`}
                  >
                    {timerType === "second" ? "●" : "○"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-heading">Second Timer</p>
                    <p className="text-xs text-neutral-400">
                      <span className="font-bold text-red-300">−{secondTimerDeduction} marks</span> penalty.
                    </p>
                  </div>
                </button>
              </div>
              {!timerType && (
                <p className="mt-2 text-xs font-semibold text-amber-400">Please select a Timer Type to continue.</p>
              )}
            </div>
          )}

          {renderVersionSelector()}
          {/* Agreement — required before the exam can start */}
          <label
            htmlFor="rules-agree"
            className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-primary-500/30 bg-primary-600/5 p-4 transition hover:bg-primary-600/10"
          >
            <input
              id="rules-agree"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary-500,#e50914)]"
            />
            <span className="text-sm font-semibold text-heading">
              I have read and agree to the exam rules
            </span>
          </label>

<div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={!agreed || (secondTimerEnabled && !timerType) || !questionVersion}
              onClick={() => {
                // Version + Timer are locked to the attempt at start — stored server-side.
                router.push(beginHref());
              }}
              title={
                !agreed
                  ? "Tick the agreement box first"
                  : !questionVersion
                    ? "Select a Question Version first"
                    : secondTimerEnabled && !timerType
                      ? "Select a Timer Type first"
                      : undefined
              }
              className="w-full sm:w-auto rounded-xl bg-primary-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:border disabled:border-ink/10 disabled:bg-dark-800 disabled:text-neutral-500 disabled:shadow-none"
            >
              Agree & Continue →
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-neutral-500">
            The timer starts as soon as you press Agree &amp; Continue.
          </p>
        </>
      )}
    </div>
  );
}
