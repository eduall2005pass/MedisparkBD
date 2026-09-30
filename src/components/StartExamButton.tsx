"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import type { ExamRulesData } from "@/components/ExamRules";

/**
 * Start Now / Start Exam button. Clicking it NEVER starts the exam — it
 * opens the dedicated Exam Rules Page for this specific exam first. The
 * attempt begins only after the student ticks the agreement checkbox and
 * presses [Agree & Continue] on that page.
 */
export default function StartExamButton({
  exam,
  disabled,
  className = "",
  children,
}: {
  exam: Pick<
    ExamRulesData,
    "name" | "courseType" | "durationMinutes" | "totalMarks" | "totalQuestions" | "negativeMarks"
  > & { id: string };
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const { user, profile, authLoading } = useAuth();
  const inFlightRef = useRef(false);

  const handleStart = () => {
    if (disabled || authLoading || inFlightRef.current) return;
    inFlightRef.current = true;
    // Release after navigation has had time to start — blocks rapid
    // double-clicks without permanently deadening the button if the
    // navigation no-ops (same route, blocked push, back-forward cache).
    setTimeout(() => {
      inFlightRef.current = false;
    }, 1500);

    if (!user) {
      router.push(
        `/login?next=${encodeURIComponent(`/exam/${exam.id}/rules`)}`,
      );
      return;
    }

    if (!profile) {
      router.push(
        `/register?next=${encodeURIComponent(`/exam/${exam.id}/rules`)}`,
      );
      return;
    }

    // Dedicated rules page for THIS exam — loaded dynamically from MySQL.
    router.push(`/exam/${exam.id}/rules`);
  };

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={disabled || authLoading}
      className={`touch-manipulation select-none transform-gpu will-change-transform transition-all duration-200 ease-out active:scale-[0.98] disabled:cursor-not-allowed ${className}`}
    >
      {children ?? (disabled ? "Not Available" : "Start Exam")}
    </button>
  );
}
