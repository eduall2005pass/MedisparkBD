// Flow 5 shared constants — PURE logic only (no server imports) so client
// components can use it too. Server data fetching lives in `@/lib/flow5`.

export type Flow5Format = "topic-wise" | "paper-final" | "subject-final" | "final-model";

export const FLOW5_FORMATS: Array<{ key: Flow5Format; title: string; subtitle: string }> = [
  { key: "topic-wise", title: "Topic-wise Exam", subtitle: "Subject-wise topic exams" },
  { key: "paper-final", title: "Paper Final Exam", subtitle: "Paper final exams" },
  { key: "subject-final", title: "Subject Final Exam", subtitle: "Subject final exams" },
  { key: "final-model", title: "Final Model Test", subtitle: "Final model tests" },
];

export function isFlow5Format(value: unknown): value is Flow5Format {
  return (
    value === "topic-wise" ||
    value === "paper-final" ||
    value === "subject-final" ||
    value === "final-model"
  );
}

// The complete 8 subjects for the Topic-wise branch (fixed, in order).
export type Flow5SubjectKey =
  | "bio1-botany"
  | "bio2-zoology"
  | "chem1"
  | "chem2"
  | "phy1"
  | "phy2"
  | "english"
  | "gk";

export const FLOW5_SUBJECTS: Array<{ key: Flow5SubjectKey; title: string }> = [
  { key: "bio1-botany", title: "Biology 1st Paper — Botany" },
  { key: "bio2-zoology", title: "Biology 2nd Paper — Zoology" },
  { key: "chem1", title: "Chemistry 1st Paper" },
  { key: "chem2", title: "Chemistry 2nd Paper" },
  { key: "phy1", title: "Physics 1st Paper" },
  { key: "phy2", title: "Physics 2nd Paper" },
  { key: "english", title: "English" },
  { key: "gk", title: "General Knowledge" },
];

export function isFlow5SubjectKey(value: unknown): value is Flow5SubjectKey {
  return FLOW5_SUBJECTS.some((s) => s.key === value);
}

export function flow5SubjectTitle(key: string): string {
  return FLOW5_SUBJECTS.find((s) => s.key === key)?.title ?? key;
}

/**
 * Unified Exam System — course-exam list item.
 * SAME complete fields as a Public Exam (one engine); only the access scope
 * differs (COURSE → enrolled students of the linked course_id, shown inside
 * Course Content). `phase` is the Upcoming → Live → Practice lifecycle
 * derived server-side from Start/End time.
 */
export type Flow5ExamPhase = "upcoming" | "live" | "practice" | "archived" | "no-window";

/** "archived" is the canonical post-live value; "practice" is a legacy alias. */
export function normalizeFlow5Phase(phase: string | null | undefined): Flow5ExamPhase | null {
  if (phase === "archived" || phase === "practice") return "archived";
  if (phase === "upcoming" || phase === "live" || phase === "no-window") return phase;
  return null;
}

/** True for post-live practice (canonical "archived" + legacy "practice" alias). */
export function isFlow5PracticePhase(phase: string | null | undefined): boolean {
  return phase === "archived" || phase === "practice";
}

export type Flow5ExamItem = {
  id: string;
  title: string;
  format: Flow5Format;
  topicSubject: Flow5SubjectKey | null;
  durationMinutes: number;
  totalMarks: number;
  scheduledAt: string | null;
  /** Unified scope marker — always COURSE for these items. */
  scope: "COURSE";
  /** Same detail fields as Public Exam cards. */
  subject: string;
  courseType: "Academic" | "Admission";
  bannerUrl: string | null;
  description: string | null;
  totalQuestions: number;
  marksPerQuestion: number;
  endsAt: string | null;
  /** Live Exam vs Practice Exam (static mode, like Public Exams). */
  examMode: "live" | "practice";
  negativeEnabled: boolean;
  negativePerWrong: number;
  secondTimerEnabled: boolean;
  secondTimerDeduction: number;
  /** Upcoming → Live → Practice lifecycle (server time). */
  phase: Flow5ExamPhase;
};
