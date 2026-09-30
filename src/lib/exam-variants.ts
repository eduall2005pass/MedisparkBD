import { randomInt } from "node:crypto";
import { ensureColumn, exec, parseJsonColumn, query } from "@/lib/mysql";
import { strictAnswerIndex } from "@/lib/paste-mcq-parser";

// Exam Language Version + Set A/B + Question Order Randomization.
//
// Model:
//  - exam_questions rows are the PERMANENT question slots. The row `id` is the
//    permanent Question ID (e.g. Q19) and `sort_order` is the admin sequence.
//    These never change per student.
//  - exam_question_variants holds the 4 possible contents per slot:
//      (bangla,A) (bangla,B) (english,A) (english,B)
//    No auto-translation is ever performed — each variant is authored separately.
//  - Legacy exams without variants fall back to the base exam_questions row
//    for every version/set, so existing exams keep working unchanged.
//  - Per attempt, the server locks (question_version, assigned_set,
//    question_order) in exam_attempts and snapshots them into exam_results.

export type QuestionVersion = "bangla" | "english";
export type QuestionSet = "A" | "B";

export const QUESTION_VERSIONS: QuestionVersion[] = ["bangla", "english"];
export const QUESTION_SETS: QuestionSet[] = ["A", "B"];

export function normalizeVersion(value: unknown): QuestionVersion | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "bangla" || v === "bn" || v === "bangla version") return "bangla";
  if (v === "english" || v === "en" || v === "english version") return "english";
  return null;
}

export function normalizeSet(value: unknown): QuestionSet | null {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "A" || v === "SET A" || v === "SET-A") return "A";
  if (v === "B" || v === "SET B" || v === "SET-B") return "B";
  return null;
}

let variantsReady: Promise<void> | null = null;
/** Create exam_question_variants + attempt/result columns (best-effort, idempotent). */
export function ensureVariantTables(): Promise<void> {
  if (!variantsReady) {
    variantsReady = (async () => {
      await exec(`CREATE TABLE IF NOT EXISTS exam_question_variants (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        question_id BIGINT UNSIGNED NOT NULL,
        lang ENUM('bangla','english') NOT NULL,
        set_label ENUM('A','B') NOT NULL,
        question TEXT NOT NULL,
        options JSON NOT NULL,
        correct_index INT NULL DEFAULT NULL,
        explanation TEXT NULL,
        marks DECIMAL(5,2) NOT NULL DEFAULT 1,
        question_image VARCHAR(1024) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_variant_slot (question_id, lang, set_label),
        KEY idx_variant_lang_set (lang, set_label),
        CONSTRAINT fk_eqv_question FOREIGN KEY (question_id)
          REFERENCES exam_questions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // Per-attempt lock: selected version + server-assigned set + shuffled order.
      try {
        await ensureColumn("exam_attempts", "question_version", "`question_version` ENUM('bangla','english') NULL AFTER timer_type");
      } catch {}
      try {
        await ensureColumn("exam_attempts", "assigned_set", "`assigned_set` ENUM('A','B') NULL AFTER question_version");
      } catch {}
      try {
        await ensureColumn("exam_attempts", "question_order", "`question_order` JSON NULL AFTER assigned_set");
      } catch {}
      // Result snapshot so the answer script can replay the student's version/set/order.
      try {
        await ensureColumn("exam_results", "question_version", "`question_version` ENUM('bangla','english') NULL AFTER attempt_type");
      } catch {}
      try {
        await ensureColumn("exam_results", "assigned_set", "`assigned_set` ENUM('A','B') NULL AFTER question_version");
      } catch {}
      try {
        await ensureColumn("exam_results", "question_order", "`question_order` JSON NULL AFTER assigned_set");
      } catch {}
    })().catch((error) => {
      variantsReady = null;
      throw error;
    });
  }
  return variantsReady;
}

/** Server-side Set assignment — cryptographically random, never client-chosen. */
export function assignSetServerSide(): QuestionSet {
  return randomInt(2) === 0 ? "A" : "B";
}

/**
 * Pure validity check for one authored variant cell (mirrors save-time rules):
 * question text (≥3 chars) or an image, at least two non-empty options, and a
 * correct index inside the options range.
 */
export function isValidVariantContent(
  question: string | null | undefined,
  optionsJson: string | null | undefined,
  correctIndex: number | string | null | undefined,
  questionImage?: string | null | undefined,
): boolean {
  const text = String(question ?? "").trim();
  if (text.length < 3 && !questionImage) return false;
  const parsed = parseJsonColumn<unknown[]>(optionsJson ?? "");
  if (!Array.isArray(parsed) || parsed.length < 2) return false;
  const options = parsed.map((o) => String(o));
  if (options.some((o) => o.length === 0)) return false;
  // An unknown answer (null/undefined) is never valid — it must not count
  // toward set availability and must never resolve to A (index 0).
  if (correctIndex === null || correctIndex === undefined) return false;
  const ci = Number(correctIndex);
  if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) return false;
  return true;
}

/** Number of VALID variant cells for one (exam, version, set). */
export async function countValidVariants(
  examId: string,
  version: QuestionVersion,
  set: QuestionSet,
): Promise<number> {
  await ensureVariantTables();
  const rows = await query<{
    question: string;
    options: string;
    correct_index: number;
    question_image: string | null;
  }[]>(
    `SELECT v.question, v.options, v.correct_index, v.question_image
       FROM exam_question_variants v
       JOIN exam_questions q ON q.id = v.question_id
      WHERE q.exam_id = ? AND q.is_active = 1 AND v.lang = ? AND v.set_label = ?`,
    [examId, version, set],
  );
  let valid = 0;
  for (const row of rows) {
    if (isValidVariantContent(row.question, row.options, row.correct_index, row.question_image)) {
      valid += 1;
    }
  }
  return valid;
}

/**
 * Which Sets actually contain the required valid question data for one exam
 * version. A Set is available only when its valid variant cells cover every
 * active question slot — an empty or partially-authored Set is unavailable.
 * Legacy exams (base-row content, no variants) report no available sets so
 * callers keep the existing assignment behavior unchanged.
 */
export async function availableSetsForExam(
  examId: string,
  version: QuestionVersion,
): Promise<QuestionSet[]> {
  try {
    await ensureVariantTables();
    const slotRows = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ? AND is_active = 1`,
      [examId],
    );
    const totalSlots = Number(slotRows[0]?.n ?? 0) || 0;
    if (totalSlots <= 0) return [];
    const [validA, validB] = await Promise.all([
      countValidVariants(examId, version, "A"),
      countValidVariants(examId, version, "B"),
    ]);
    const out: QuestionSet[] = [];
    if (validA >= totalSlots) out.push("A");
    if (validB >= totalSlots) out.push("B");
    return out;
  } catch {
    // On DB errors report no available sets — callers keep the legacy
    // random assignment instead of blocking the exam start.
    return [];
  }
}

/**
 * Availability-aware Set assignment for an attempt start. When exactly one
 * Set holds complete valid data it is used directly (no random draw, never an
 * unavailable Set). When both or neither do, fall back to the existing
 * random server-side assignment (legacy/base-row exams behave as before).
 */
export async function assignSetForExam(
  examId: string,
  version: QuestionVersion,
): Promise<QuestionSet> {
  try {
    const available = await availableSetsForExam(examId, version);
    if (available.length === 1) return available[0];
  } catch {
    // On DB errors keep the legacy behavior — never block an exam start.
  }
  return assignSetServerSide();
}

/** Fisher–Yates shuffle with crypto randomness. Returns a new array. */
export function shuffledOrder(ids: number[]): number[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type VariantRow = {
  question_id: number;
  lang: string;
  set_label: string;
  question: string;
  options: string;
  /** NULL = unknown (never defaulted to 0/A). */
  correct_index: number | null;
  explanation: string | null;
  marks: string | number;
  question_image: string | null;
};

/** All variants for one exam, keyed by `${questionId}:${lang}:${set}`. */
export async function fetchVariantMap(
  examId: string,
): Promise<Map<string, VariantRow>> {
  const map = new Map<string, VariantRow>();
  try {
    await ensureVariantTables();
    const rows = await query<VariantRow[]>(
      `SELECT v.question_id, v.lang, v.set_label, v.question, v.options,
              v.correct_index, v.explanation, v.marks, v.question_image
        FROM exam_question_variants v
        JOIN exam_questions q ON q.id = v.question_id
       WHERE q.exam_id = ? AND q.is_active = 1`,
      [examId],
    );
    for (const row of rows) {
      map.set(`${Number(row.question_id)}:${row.lang}:${row.set_label}`, row);
    }
  } catch {
    // No variants — callers fall back to base rows.
  }
  return map;
}

export type ResolvedQuestion = {
  /** Permanent Question ID — exam_questions.id, never the display serial. */
  id: number;
  question: string;
  options: string[];
  marks: number;
  /** NULL = unknown answer (rendered as "—", never as A). */
  correctIndex: number | null;
  explanation: string | null;
  questionImage: string | null;
  /** True when this content came from the authored version/set variant. */
  fromVariant: boolean;
  /** Mirrors fromVariant — false whenever variant content is corrupt/absent. */
  hasVariant: boolean;
};

export type BaseQuestionRow = {
  id: number;
  question: string;
  options: string;
  marks: string | number;
  /** NULL = unknown (never defaulted to 0/A). */
  correct_index: number | null;
  explanation: string | null;
  question_image?: string | null;
  sort_order?: number | null;
};

/** Preserve an explicit unknown (NULL) — never coerce it to 0/A. */
function preserveAnswerIndex(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Resolve displayable marks: finite > 0 wins, else the fallback, else 1. */
export function resolveMarks(raw: unknown, fallback: unknown): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const f = Number(fallback);
  if (Number.isFinite(f) && f > 0) return f;
  return 1;
}

/**
 * Overlay one authored variant cell onto a base question row (admin version/set
 * view). Corrupt variant options JSON yields hasVariant:false with pure base
 * content — never a mix of variant text with base options. Invalid variant
 * marks fall back to the base marks (validated finite > 0, else 1).
 */
export function overlayVariantOntoBase(
  base: Record<string, unknown>,
  variant: VariantRow | undefined | null,
): Record<string, unknown> & { hasVariant: boolean } {
  if (!variant) return { ...base, hasVariant: false };
  const parsed = parseJsonColumn<unknown[]>(variant.options);
  if (!Array.isArray(parsed)) return { ...base, hasVariant: false };
  const answer = preserveAnswerIndex(variant.correct_index);
  return {
    ...base,
    question: variant.question,
    options: parsed.map(String),
    // Overlay the authored answer — base answer must not leak into a variant
    // view (and vice versa). NULL stays NULL, never coerced to 0/A.
    correctIndex: answer,
    correct_index: answer,
    marks: resolveMarks(variant.marks, base.marks),
    explanation: variant.explanation ?? null,
    questionImage: variant.question_image ?? null,
    question_image: variant.question_image ?? null,
    hasVariant: true,
  };
}
/**
 * Resolve displayable questions for one (version, set): variant content wins,
 * base exam_questions row is the fallback. Result is in ADMIN order
 * (sort_order, id); callers apply the locked shuffled order afterwards.
 * A corrupt variant cell (non-array options JSON) falls back to the pure base
 * row with fromVariant:false AND hasVariant:false — never mixed sources.
 */
export function resolveQuestions(
  baseRows: BaseQuestionRow[],
  variants: Map<string, VariantRow>,
  version: QuestionVersion,
  set: QuestionSet,
): ResolvedQuestion[] {
  const out: ResolvedQuestion[] = [];
  for (const row of baseRows) {
    const variant = variants.get(`${Number(row.id)}:${version}:${set}`);
    if (variant) {
      const parsed = parseJsonColumn<unknown[]>(variant.options);
      if (Array.isArray(parsed)) {
        out.push({
          id: Number(row.id),
          question: variant.question,
          options: parsed.map(String),
          marks: resolveMarks(variant.marks, row.marks),
          correctIndex: preserveAnswerIndex(variant.correct_index),
          explanation: variant.explanation ?? null,
          questionImage: variant.question_image ?? null,
          fromVariant: true,
          hasVariant: true,
        });
        continue;
      }
    }
    const parsed = parseJsonColumn<unknown[]>(row.options);
    if (!Array.isArray(parsed)) continue;
    out.push({
      id: Number(row.id),
      question: row.question,
      options: parsed.map(String),
      marks: resolveMarks(row.marks, 1),
      correctIndex: preserveAnswerIndex(row.correct_index),
      explanation: row.explanation ?? null,
      questionImage: (row.question_image as string | null) ?? null,
      fromVariant: false,
      hasVariant: false,
    });
  }
  return out;
}

/** Coverage counts per version/set for the admin UI (how many slots have variants). */
export async function variantCoverage(examId: string): Promise<{
  totalSlots: number;
  coverage: Record<string, number>;
  hasAnyVariant: boolean;
  error?: boolean;
}> {
  const fallback = { totalSlots: 0, coverage: {} as Record<string, number>, hasAnyVariant: false, error: true };
  try {
    await ensureVariantTables();
    const slots = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ? AND is_active = 1`,
      [examId],
    );
    const totalSlots = Number(slots[0]?.n ?? 0) || 0;
    const rows = await query<{ lang: string; set_label: string; n: number }[]>(
      `SELECT v.lang AS lang, v.set_label AS set_label, COUNT(*) AS n
         FROM exam_question_variants v
         JOIN exam_questions q ON q.id = v.question_id
        WHERE q.exam_id = ? AND q.is_active = 1
        GROUP BY v.lang, v.set_label`,
      [examId],
    );
    const coverage: Record<string, number> = {};
    for (const row of rows) coverage[`${row.lang}:${row.set_label}`] = Number(row.n) || 0;
    return {
      totalSlots,
      coverage,
      hasAnyVariant: Object.values(coverage).some((n) => n > 0),
    };
  } catch {
    return fallback;
  }
}

export type VariantInput = {
  questionId: number;
  version: QuestionVersion;
  set: QuestionSet;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
  marks?: number;
  questionImage?: string | null;
};

/** Upsert one variant cell. Throws on validation errors. */
export async function saveVariant(input: VariantInput): Promise<void> {
  await ensureVariantTables();
  const text = (input.question ?? "").trim();
  if (text.length < 3 && !input.questionImage) {
    throw new Error("Question text or image is required (at least 3 characters or an image).");
  }
  const options = Array.isArray(input.options) ? input.options.map((o) => String(o)) : [];
  if (options.length < 2 || options.some((o) => o.length === 0)) {
    throw new Error("At least two non-empty options are required.");
  }
  // Strict: missing/malformed answers are rejected loudly — never stored as A.
  const strictIndex = strictAnswerIndex(input.correctIndex as unknown, options.length);
  if (strictIndex === null) {
    throw new Error("Correct answer is missing or invalid — select A, B, C or D.");
  }
  const marks = Number(input.marks);
  const safeMarks = Number.isFinite(marks) && marks > 0 ? marks : 1;
  await exec(
    `INSERT INTO exam_question_variants
       (question_id, lang, set_label, question, options, correct_index, explanation, marks, question_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE question = VALUES(question), options = VALUES(options),
       correct_index = VALUES(correct_index), explanation = VALUES(explanation),
       marks = VALUES(marks), question_image = VALUES(question_image)`,
    [
      input.questionId,
      input.version,
      input.set,
      text,
      JSON.stringify(options),
      strictIndex,
      input.explanation ?? null,
      safeMarks,
      input.questionImage ?? null,
    ],
  );
}
