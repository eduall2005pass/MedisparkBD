import { exec, parseJsonColumn, query } from "@/lib/mysql";
import { fetchExamById } from "@/lib/exams-admin";
import {
  fetchVariantMap,
  normalizeSet,
  normalizeVersion,
  resolveMarks,
  type VariantRow,
} from "@/lib/exam-variants";
import { normalizeStoredAnswerIndex } from "@/lib/paste-mcq-parser";
import {
  negativePerWrongFor,
  updateMeritPositions,
} from "@/lib/exam-taking";

// Automatic result recalculation after an Admin corrects an Answer Key.
//
// The latest corrected Answer Key (base `exam_questions.correct_index` +
// per-version/set `exam_question_variants.correct_index`) is the single
// source of truth. Every stored result is recomputed FROM SCRATCH from the
// student's immutable stored answers + the latest key — never by stacking
// deltas — so repeated corrections converge instead of double-adding.
//
// Per-question rules (mirror `gradeAnswers` in exam-taking.ts):
//   - unanswered (chosen null)                        → obtained 0
//   - chosen matches the corrected key                → obtained +marks
//     (any previous negative on that question disappears with the rebuild)
//   - chosen does not match (or key unknown)          → obtained −neg, wrong+1
// Student answers, snapshots, timer penalties and history are preserved;
// only score / details / negative_deduction / total_marks are rewritten,
// then merit positions are rebuilt for ranked attempts.

export type AnswerKeySnapshot = {
  base: Map<number, string>;
  variants: Map<string, string>;
};

function cellKey(correct: unknown, marks: unknown, options?: unknown): string {
  const c = correct === null || correct === undefined ? "null" : String(Number(correct));
  const m = Number(marks);
  const o = typeof options === "string" ? options : JSON.stringify(options ?? null);
  return `${c}|${Number.isFinite(m) ? m : 1}|${o}`;
}

/** Best-effort snapshot of an exam's full answer key (base + all variants). */
export async function snapshotAnswerKey(
  examId: string,
): Promise<AnswerKeySnapshot | null> {
  try {
    const id = examId?.trim();
    if (!id) return null;
    const base = new Map<number, string>();
    try {
      const rows = await query<
        { id: number; correct_index: number | null; marks: string | number; options: string; is_active: number | boolean }[]
      >(
        `SELECT id, correct_index, marks, options, is_active FROM exam_questions WHERE exam_id = ?`,
        [id],
      );
      for (const r of rows) {
        base.set(Number(r.id), `${cellKey(r.correct_index, r.marks, r.options)}|${r.is_active ? 1 : 0}`);
      }
    } catch {
      return null;
    }
    const variants = new Map<string, string>();
    try {
      const map = await fetchVariantMap(id);
      for (const [key, cell] of map) {
        variants.set(key, cellKey(cell.correct_index, cell.marks, cell.options));
      }
    } catch {
      // Base-only snapshot still detects base key changes.
    }
    return { base, variants };
  } catch {
    return null;
  }
}

function snapshotsEqual(a: AnswerKeySnapshot, b: AnswerKeySnapshot): boolean {
  if (a.base.size !== b.base.size || a.variants.size !== b.variants.size) return false;
  for (const [k, v] of a.base) if (b.base.get(k) !== v) return false;
  for (const [k, v] of a.variants) if (b.variants.get(k) !== v) return false;
  return true;
}

export type RecalcOutcome = {
  /** True when the key actually changed (recalculation ran). */
  changed: boolean;
  /** Number of stored results rewritten. */
  recalculated: number;
  /** Results left untouched (mapping could not be proven safe). */
  skipped: number;
};

/**
 * Compare the live key against a pre-save snapshot; when anything changed,
 * recompute every stored result of the exam from answers + latest key and
 * rebuild merit positions. Safe to call when nothing changed (no-op).
 */
export async function recalculateIfAnswerKeyChanged(
  examId: string,
  before: AnswerKeySnapshot | null,
): Promise<RecalcOutcome> {
  try {
    if (!before) return { changed: false, recalculated: 0, skipped: 0 };
    const after = await snapshotAnswerKey(examId);
    if (!after || snapshotsEqual(before, after)) {
      return { changed: false, recalculated: 0, skipped: 0 };
    }
    const { recalculated, skipped } = await recalculateExamResults(examId);
    return { changed: true, recalculated, skipped };
  } catch {
    return { changed: false, recalculated: 0, skipped: 0 };
  }
}

type StoredResultRow = {
  id: number;
  answers: string | null;
  details: string | null;
  timer_penalty: string | number | null;
  question_version?: string | null;
  assigned_set?: string | null;
};

type RecalcDetail = {
  questionId: number;
  chosenIndex: number | null;
  correctIndex: number | null;
  marks: number;
  obtained: number;
};

type EffectiveAnswer = { correct: number | null; marks: number };

/**
 * Effective grading values of one key family for every active question —
 * the exact submit-time fallback: a variant cell counts only when its
 * options parse (else base wins), same as `resolveQuestions`.
 */
function effectiveMap(
  baseRows: { id: number; correct_index: number | null; marks: string | number; options: string }[],
  variantMap: Map<string, VariantRow>,
  version: string | null,
  set: string | null,
): Map<number, EffectiveAnswer> {
  const out = new Map<number, EffectiveAnswer>();
  for (const r of baseRows) {
    const qid = Number(r.id);
    const baseMarks = resolveMarks(r.marks, 1);
    // Unparseable base options grade nothing — same as resolveQuestions,
    // which drops such rows instead of guessing.
    if (!Array.isArray(parseJsonColumn<unknown[]>(r.options))) continue;
    if (!version || !set) {
      out.set(qid, {
        correct: normalizeStoredAnswerIndex(r.correct_index),
        marks: baseMarks,
      });
      continue;
    }
    const cell = variantMap.get(`${qid}:${version}:${set}`);
    const parsed = cell ? parseJsonColumn<unknown[]>(cell.options) : null;
    if (cell && Array.isArray(parsed)) {
      out.set(qid, {
        correct: normalizeStoredAnswerIndex(cell.correct_index),
        marks: resolveMarks(cell.marks, r.marks),
      });
    } else {
      out.set(qid, {
        correct: normalizeStoredAnswerIndex(r.correct_index),
        marks: baseMarks,
      });
    }
  }
  return out;
}

/**
 * Prove which key family graded one stored result:
 * own snapshot wins; otherwise majority vote of the grading-time correct
 * answers. Tied families grade identically (e.g. Set B shares answers
 * across languages) and are interchangeable; anything else is skipped.
 * Self-contained per result — a later retake can never poison it.
 */
function voteMapping(
  detailsList: RecalcDetail[],
  baseRows: { id: number; correct_index: number | null; marks: string | number; options: string }[],
  variantMap: Map<string, VariantRow>,
): { version: string; set: string } | { base: true } | null {
  const known = detailsList.filter(
    (d) =>
      typeof d.questionId === "number" &&
      d.correctIndex !== null &&
      d.correctIndex !== undefined,
  );
  if (known.length < 5) return null;
  const families: ({ version: string; set: string } | { base: true })[] = [
    { base: true },
    { version: "bangla", set: "A" },
    { version: "bangla", set: "B" },
    { version: "english", set: "A" },
    { version: "english", set: "B" },
  ];
  const eff = families.map((f) =>
    "base" in f
      ? effectiveMap(baseRows, variantMap, null, null)
      : effectiveMap(baseRows, variantMap, f.version, f.set),
  );
  let bestIdx = -1;
  let bestHits = -1;
  let bestTotal = 0;
  const scored = eff.map((map) => {
    let hits = 0;
    let total = 0;
    for (const d of known) {
      const cellEff = map.get(Number(d.questionId));
      if (!cellEff) continue;
      total += 1;
      if (cellEff.correct === Number(d.correctIndex)) hits += 1;
    }
    return { hits, total };
  });
  for (let i = 0; i < scored.length; i += 1) {
    // Families with too few gradable questions cannot win.
    if (scored[i].total < 5) continue;
    if (scored[i].hits > bestHits) {
      bestIdx = i;
      bestHits = scored[i].hits;
      bestTotal = scored[i].total;
    }
  }
  if (bestIdx === -1 || bestTotal === 0 || bestHits / bestTotal < 0.6) {
    return null;
  }
  // Every family tied at the top must grade identically — else skip.
  const winner = eff[bestIdx];
  for (let i = 0; i < scored.length; i += 1) {
    if (i === bestIdx || scored[i].total < 5 || scored[i].hits !== bestHits) continue;
    const other = eff[i];
    let identical = true;
    for (const r of baseRows) {
      const a = winner.get(Number(r.id));
      const b = other.get(Number(r.id));
      if (!a || !b || a.correct !== b.correct || a.marks !== b.marks) {
        identical = false;
        break;
      }
    }
    if (!identical) return null;
  }
  return families[bestIdx];
}

/**
 * Recompute every stored result of one exam from immutable student answers
 * plus the latest answer key. Applies to Public AND Course exams alike.
 * Timer penalties are preserved as stored; merit is rebuilt afterwards.
 * A result is rewritten only when its key mapping is proven; the rest are
 * reported as skipped and left untouched.
 */
export async function recalculateExamResults(
  examId: string,
): Promise<{ recalculated: number; skipped: number }> {
  const id = examId?.trim();
  if (!id) return { recalculated: 0, skipped: 0 };
  const exam = await fetchExamById(id).catch(() => null);
  const negativePerWrong = negativePerWrongFor(
    exam ?? { courseType: "Academic" },
  );

  const baseRows = await query<
    { id: number; correct_index: number | null; marks: string | number; options: string }[]
  >(
    `SELECT id, correct_index, marks, options FROM exam_questions
      WHERE exam_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
    [id],
  );
  if (baseRows.length === 0) return { recalculated: 0, skipped: 0 };

  let variantMap = new Map<string, VariantRow>();
  try {
    variantMap = await fetchVariantMap(id);
  } catch {
    variantMap = new Map<string, VariantRow>();
  }

  const results = await query<StoredResultRow[]>(
    `SELECT id, answers, details, timer_penalty, question_version, assigned_set
       FROM exam_results WHERE exam_id = ? ORDER BY id ASC`,
    [id],
  ).catch(async () => {
    // Legacy DBs without the snapshot columns.
    const legacy = await query<{ id: number; answers: string | null; details: string | null; timer_penalty: string | number | null }[]>(
      `SELECT id, answers, details, timer_penalty FROM exam_results WHERE exam_id = ? ORDER BY id ASC`,
      [id],
    );
    return legacy as StoredResultRow[];
  });
  if (results.length === 0) return { recalculated: 0, skipped: 0 };

  let rewritten = 0;
  let skipped = 0;
  for (const result of results) {
    try {
      const answers = parseJsonColumn<Record<string, number>>(result.answers) ?? {};
      const storedDetails = parseJsonColumn<RecalcDetail[]>(result.details);
      const detailsList = Array.isArray(storedDetails) ? storedDetails : [];

      const snapVersion = normalizeVersion(result.question_version);
      const snapSet = normalizeSet(
        typeof result.assigned_set === "string" ? result.assigned_set : null,
      );
      const mapping =
        snapVersion && snapSet
          ? { version: snapVersion, set: snapSet } as const
          : voteMapping(detailsList, baseRows, variantMap);
      if (!mapping) {
        skipped += 1;
        continue;
      }
      const eff =
        "base" in mapping
          ? effectiveMap(baseRows, variantMap, null, null)
          : effectiveMap(baseRows, variantMap, mapping.version, mapping.set);

      let score = 0;
      let wrongCount = 0;
      let totalMarks = 0;
      const details: RecalcDetail[] = [];
      for (const r of baseRows) {
        const qid = Number(r.id);
        const cellEff = eff.get(qid);
        if (!cellEff) continue;
        totalMarks += cellEff.marks;
        const chosen = normalizeStoredAnswerIndex(answers[String(qid)]);
        if (chosen === null) {
          details.push({ questionId: qid, chosenIndex: null, correctIndex: cellEff.correct, marks: cellEff.marks, obtained: 0 });
          continue;
        }
        if (cellEff.correct !== null && chosen === cellEff.correct) {
          score += cellEff.marks;
          details.push({ questionId: qid, chosenIndex: chosen, correctIndex: cellEff.correct, marks: cellEff.marks, obtained: cellEff.marks });
        } else {
          score -= negativePerWrong;
          wrongCount += 1;
          details.push({ questionId: qid, chosenIndex: chosen, correctIndex: cellEff.correct, marks: cellEff.marks, obtained: -negativePerWrong });
        }
      }
      score = Math.max(0, Math.round(score * 100) / 100);
      totalMarks = Math.round(totalMarks * 100) / 100;
      const negativeDeduction =
        wrongCount > 0 && negativePerWrong > 0
          ? Math.round(negativePerWrong * wrongCount * 100) / 100
          : 0;
      const timerPenaltyRaw = Number(result.timer_penalty);
      const timerPenalty = Number.isFinite(timerPenaltyRaw) && timerPenaltyRaw > 0 ? timerPenaltyRaw : 0;
      const finalScore = Math.max(0, Math.round((score - timerPenalty) * 100) / 100);

      await exec(
        `UPDATE exam_results
            SET score = ?, total_marks = ?, details = ?, negative_deduction = ?
          WHERE id = ?`,
        [finalScore, totalMarks, JSON.stringify(details), negativeDeduction, result.id],
      );
      rewritten += 1;
    } catch {
      // One bad row never blocks the rest; count it as skipped.
      skipped += 1;
    }
  }

  // Rebuild merit positions for ranked attempts; practice stays NULL.
  try {
    await updateMeritPositions(id);
  } catch {
    // Best-effort — scores are already correct.
  }
  return { recalculated: rewritten, skipped };
}
