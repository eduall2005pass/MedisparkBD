export const ENROLLED_EXAM_CARD_KEY = "my_enrolled_exams";

export const ENROLLED_EXAM_CARD_ICONS = [
  { value: "clipboard-list", label: "Exam clipboard" },
  { value: "book-open", label: "Open book" },
  { value: "graduation-cap", label: "Graduation cap" },
  { value: "calendar", label: "Calendar" },
] as const;

export type EnrolledExamCardSettings = {
  is_active: boolean;
  title: string;
  subtitle: string;
  icon: (typeof ENROLLED_EXAM_CARD_ICONS)[number]["value"];
};

export const DEFAULT_ENROLLED_EXAM_CARD: EnrolledExamCardSettings = {
  is_active: true,
  title: "My Enrolled Exams",
  subtitle: "Go directly to exams in your enrolled courses.",
  icon: "clipboard-list",
};

/** Validate complete settings, not coercions of arbitrary client input. */
export function validateEnrolledExamCard(input: unknown): EnrolledExamCardSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid card settings.");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.is_active !== "boolean") throw new Error("Visibility must be a boolean.");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > 120) {
    throw new Error("Title must contain 1–120 characters.");
  }
  if (typeof value.subtitle !== "string" || value.subtitle.trim().length > 500) {
    throw new Error("Subtitle must contain at most 500 characters.");
  }
  if (!ENROLLED_EXAM_CARD_ICONS.some((icon) => icon.value === value.icon)) {
    throw new Error("Select a supported card icon.");
  }
  return {
    is_active: value.is_active,
    title: value.title.trim(),
    subtitle: value.subtitle.trim(),
    icon: value.icon as EnrolledExamCardSettings["icon"],
  };
}
