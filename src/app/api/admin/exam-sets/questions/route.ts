import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/admin";
import { exec, query } from "@/lib/mysql";
import {
  allocateQuestionUid,
  correctLetterToIndex,
  ensureAutoSyncTables,
  ensureExamSets,
  markTranslationStale,
  normalizeDifficulty,
  normalizeSyncSet,
  normalizeTopic,
  syncTranslationFor,
} from "@/lib/exam-autosync";

export const dynamic = "force-dynamic";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * Bangla MASTER write API. Every mutation auto-syncs the English translation
 * (queued, non-blocking) and can never change English independently.
 * Actions: create | update | delete | reorder | move-set
 */
export async function POST(request: NextRequest) {
  const admin = await requireAnyPermission(request, ["manageExams", "managePublicExam"]);
  if (!admin) return bad("Unauthorized.", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Invalid body.");
  const action = String(body.action ?? "create").toLowerCase();
  try {
    await ensureAutoSyncTables();
    if (action === "reorder") {
      const examId = String(body.examId ?? "").trim();
      const set = normalizeSyncSet(body.set);
      const order = Array.isArray(body.order) ? body.order.map(Number).filter((n) => Number.isInteger(n)) : [];
      if (!examId || !set || order.length === 0) return bad("examId, set and order[] are required.");
      for (let i = 0; i < order.length; i += 1) {
        await exec(`UPDATE exam_questions SET sort_order = ? WHERE id = ? AND exam_id = ? AND set_label = ?`, [i + 1, order[i], examId, set]);
        void markTranslationStale(order[i]).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return bad("Missing question id.");
      await exec(`UPDATE exam_questions SET is_active = 0 WHERE id = ?`, [id]);
      void markTranslationStale(id).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (action === "move-set") {
      const id = Number(body.id);
      const set = normalizeSyncSet(body.set);
      if (!Number.isInteger(id) || !set) return bad("id and set are required.");
      const rows = await query<{ exam_id: string; question_uid: string | null }[]>(
        `SELECT exam_id, question_uid FROM exam_questions WHERE id = ? LIMIT 1`, [id],
      );
      const row = rows[0];
      if (!row) return bad("Question not found.", 404);
      if (row.question_uid) {
        const dup = await query<{ id: number }[]>(
          `SELECT id FROM exam_questions WHERE exam_id = ? AND question_uid = ? AND set_label != (SELECT set_label FROM exam_questions WHERE id = ?) AND is_active = 1 LIMIT 1`,
          [row.exam_id, row.question_uid, id],
        );
        void dup;
      }
      // Disjoint guard: the uid is unique to its row; moving keeps one home.
      const examId = row.exam_id;
      const targetRows = await query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM exam_questions WHERE exam_id = ? AND set_label = ? AND is_active = 1`, [examId, set],
      );
      void targetRows;
      // Renumber within target set (append at end).
      const maxRows = await query<{ m: number | null }[]>(
        `SELECT MAX(sort_order) AS m FROM exam_questions WHERE exam_id = ? AND set_label = ? AND is_active = 1`, [examId, set],
      );
      const nextOrder = (Number(maxRows[0]?.m) || 0) + 1;
      await exec(`UPDATE exam_questions SET set_label = ?, sort_order = ? WHERE id = ?`, [set, nextOrder, id]);
      void markTranslationStale(id).then(() => syncTranslationFor(id)).catch(() => {});
      return NextResponse.json({ ok: true, set, sortOrder: nextOrder });
    }
    if (action === "update") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return bad("Missing question id.");
      const topic = body.topic !== undefined ? normalizeTopic(body.topic) : undefined;
      if (body.topic !== undefined && !topic) return bad("Invalid topic.");
      const difficulty = body.difficulty !== undefined
        ? (body.difficulty === null ? null : normalizeDifficulty(body.difficulty))
        : undefined;
      if (body.difficulty !== undefined && body.difficulty !== null && !difficulty) return bad("Invalid difficulty.");
      const correctLetter = body.correctOption !== undefined
        ? correctLetterToIndex(body.correctOption)
        : undefined;
      if (body.correctOption !== undefined && correctLetter === null) return bad("correctOption must be A/B/C/D.");
      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.question !== undefined) { sets.push(`question = ?`); params.push(String(body.question)); }
      if (body.options !== undefined) {
        const opts = Array.isArray(body.options) ? body.options.map(String) : null;
        if (!opts || opts.length < 4 || opts.slice(0, 4).some((o) => !o.trim())) return bad("Four non-empty options are required.");
        sets.push(`options = ?`); params.push(JSON.stringify(opts.slice(0, 4)));
      }
      if (correctLetter !== undefined) { sets.push(`correct_index = ?`); params.push(correctLetter); }
      if (topic !== undefined) { sets.push(`topic = ?`); params.push(topic); }
      if (difficulty !== undefined) { sets.push(`difficulty = ?`); params.push(difficulty); }
      if (body.explanation !== undefined) { sets.push(`explanation = ?`); params.push(body.explanation ? String(body.explanation) : null); }
      if (body.marks !== undefined) { sets.push(`marks = ?`); params.push(Number(body.marks) || 1); }
      if (body.subject !== undefined) { sets.push(`bank_subject = ?`); params.push(String(body.subject)); }
      if (sets.length === 0) return bad("Nothing to update.");
      params.push(id);
      await exec(`UPDATE exam_questions SET ${sets.join(", ")} WHERE id = ?`, params);
      await exec(`UPDATE question_translations SET translation_status = 'needs_update' WHERE question_id = ? AND translation_status != 'manually_edited'`, [id]);
      // Queue regeneration without blocking the admin UI.
      void syncTranslationFor(id).catch(() => {});
      return NextResponse.json({ ok: true, translation: "queued" });
    }
    // create (default)
    const examId = String(body.examId ?? "").trim();
    const set = normalizeSyncSet(body.set);
    const topic = normalizeTopic(body.topic);
    if (!examId) return bad("examId is required.");
    if (!set) return bad("set must be A or B.");
    if (!topic) return bad("topic must be one of Cell Structure, Cell Division, Cell Chemistry, Microorganisms.");
    const qText = String(body.question ?? "").trim();
    if (qText.length < 3) return bad("Question text is required (at least 3 characters).");
    const opts = Array.isArray(body.options) ? body.options.map((o: unknown) => String(o)) : [];
    if (opts.length < 4 || opts.slice(0, 4).some((o) => !o.trim())) return bad("Four non-empty options are required.");
    const correct = correctLetterToIndex(body.correctOption);
    if (correct === null) return bad("correctOption must be A/B/C/D.");
    const difficulty = body.difficulty === undefined || body.difficulty === null
      ? null : normalizeDifficulty(body.difficulty);
    if (body.difficulty !== undefined && body.difficulty !== null && !difficulty) return bad("Invalid difficulty.");
    await ensureExamSets(examId);
    // Duplicate guard: same Bangla text must not already live in the other set.
    const dupRows = await query<{ id: number; set_label: string }[]>(
      `SELECT id, set_label FROM exam_questions WHERE exam_id = ? AND is_active = 1 AND question = ? LIMIT 1`, [examId, qText],
    );
    if (dupRows[0] && dupRows[0].set_label !== set) {
      return NextResponse.json(
        { error: "Duplicate Question Detected — This question is already assigned to another set." },
        { status: 409 },
      );
    }
    const uid = await allocateQuestionUid();
    const countRows = await query<{ m: number | null }[]>(
      `SELECT MAX(sort_order) AS m FROM exam_questions WHERE exam_id = ? AND set_label = ? AND is_active = 1`, [examId, set],
    );
    const sortOrder = (Number(countRows[0]?.m) || 0) + 1;
    const marks = Number(body.marks) > 0 ? Number(body.marks) : 1;
    const res = (await exec(
      `INSERT INTO exam_questions
         (exam_id, set_label, question_uid, bank_subject, topic, question, options, correct_index, explanation, difficulty, marks, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [examId, set, uid, String(body.subject ?? ""), topic, qText, JSON.stringify(opts.slice(0, 4)),
        correct, body.explanation ? String(body.explanation) : null, difficulty, marks, sortOrder],
    )) as unknown as { insertId?: number };
    const newId = Number((res as { insertId?: number })?.insertId) || 0;
    if (newId) void syncTranslationFor(newId).catch(() => {});
    return NextResponse.json({ ok: true, id: newId, questionUid: uid, sortOrder, translation: "queued" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
