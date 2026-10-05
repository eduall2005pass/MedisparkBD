import type { BaseQuestionRow, QuestionSet, QuestionVersion, VariantRow } from "./exam-variants";
import { normalizeStoredAnswerIndex } from "./paste-mcq-parser.ts";

/** Result URLs use strict ISO language codes; authoring/session values stay unchanged. */
export function parseExamVersion(value: unknown): QuestionVersion | null {
  return value === "en" ? "english" : value === "bn" ? "bangla" : null;
}

export function examResultApiPath(examId: string, version?: QuestionVersion | null): string {
  const path = `/api/exams/${encodeURIComponent(examId)}/result`;
  return version ? `${path}?exam_version=${version === "english" ? "en" : "bn"}` : path;
}

export type ResultQuestionContent = {
  question: string;
  options: string[];
  marks: number;
  correctIndex: number | null;
  explanation: string | null;
  questionImage: string | null;
  contentFallback: "base" | "unavailable" | null;
};

function optionsFrom(value: unknown): string[] {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map((option) => String(option ?? "")) : [];
  } catch {
    return [];
  }
}

function marksFrom(value: unknown, fallback: number): number {
  const marks = Number(value);
  return Number.isFinite(marks) && marks > 0 ? marks : fallback;
}

function contentFrom(
  row: BaseQuestionRow | VariantRow,
  fallbackMarks: number,
  contentFallback: ResultQuestionContent["contentFallback"],
): ResultQuestionContent | null {
  const question = String(row.question ?? "");
  const options = optionsFrom(row.options);
  if ((!question.trim() && !row.question_image) || options.length < 2 || options.some((option) => !option.trim())) {
    return null;
  }
  const correctIndex = normalizeStoredAnswerIndex(row.correct_index);
  return {
    question,
    options,
    marks: marksFrom(row.marks, fallbackMarks),
    correctIndex: correctIndex !== null && correctIndex < options.length ? correctIndex : null,
    explanation: row.explanation ?? null,
    questionImage: row.question_image ?? null,
    contentFallback,
  };
}

/**
 * Replay one language/set as a whole cell, never mixing translated stems with
 * base options/answers/explanations. A known set must never fall back to another
 * set (A/B may be different questions). Only legacy results without a set try
 * A then B in the selected language. Missing/corrupt translations use the whole
 * original base row, explicitly flagged; empty slots show an unavailable notice
 * rather than an arbitrary paper in another language/set.
 */
export function resolveResultQuestionContent(
  base: BaseQuestionRow,
  variants: Map<string, VariantRow>,
  version: QuestionVersion,
  set: QuestionSet | null,
): ResultQuestionContent {
  const marks = marksFrom(base.marks, 1);
  for (const candidateSet of set ? [set] : ["A", "B"]) {
    const variant = variants.get(`${Number(base.id)}:${version}:${candidateSet}`);
    if (!variant) continue;
    const content = contentFrom(variant, marks, null);
    if (content) return content;
  }
  const original = contentFrom(base, marks, "base");
  if (original) return original;
  return {
    question: `Question content is unavailable in ${version === "english" ? "English" : "Bangla"}.`,
    options: [],
    marks,
    correctIndex: null,
    explanation: null,
    questionImage: null,
    contentFallback: "unavailable",
  };
}
