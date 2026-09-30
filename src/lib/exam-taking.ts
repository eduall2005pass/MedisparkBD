import { randomUUID } from "node:crypto";
import { ensureColumn, exec, parseJsonColumn, query, withTransaction } from "@/lib/mysql";
import { fetchExams, hasEnrolledExamAccess, type Exam } from "@/lib/exams-admin";
import {
  assignSetForExam,
  ensureVariantTables,
  fetchVariantMap,
  normalizeVersion,
  resolveMarks,
  resolveQuestions,
  shuffledOrder,
  type QuestionSet,
  type QuestionVersion,
  type ResolvedQuestion,
  type VariantRow,
} from "@/lib/exam-variants";
import type { RowDataPacket } from "mysql2/promise";
import { normalizeStoredAnswerIndex } from "@/lib/paste-mcq-parser";

// Student-facing exam taking. MediSpark exam rules enforced here:
//  - answers are stored server-side and locked after the first selection
//  - free-scrolling single-page paper (all questions visible, any order)
//  - negative marking is a per-exam Admin setting (ON → −0.25 per wrong)
//  - second-timer penalty (per-exam Admin setting): repeating the SAME exam
//    deducts extra marks AFTER negative marking; first attempts never lose marks
//  - starting an attempt on another device terminates + auto-submits the
//    previous session
// Questions are always sanitized (no correct answers leave the server).

export type TakingExam = {
  id: string;
  title: string;
  subject: string;
  batchId: string;
  courseType: "Academic" | "Admission";
  durationMinutes: number;
  totalMarks: number;
  negativeMarks: number;
  startedAt: string | null;
  /** Course lifecycle phase — null for non-course / public exams */
  phase?: "draft" | "upcoming" | "live" | "closed" | "archived" | "practice" | "no-window" | null;
  /** True when a public live-mode exam is past its End Time (post-live Practice phase). Attempts are unranked practice attempts. */
  isPostLivePractice?: boolean;
  /** True when this is a Flow 4 Exam Batch exam */
  isFlow4?: boolean;
};

/** MediSpark rule: negative marking only for Medical Admission exams. */
export function negativeMarksFor(courseType: string): number {
  return courseType === "Admission" ? 0.25 : 0;
}

/** Per-exam Admin setting — wrong-answer penalty (0 when the toggle is OFF). */
export function negativePerWrongFor(exam: {
  negativeEnabled?: boolean;
  negativePerWrong?: number;
  courseType: string;
  ruleTemplate?: string | null;
}): number {
  // Rule template is the source of truth when present (Spec §17).
  if (exam.ruleTemplate) {
    switch (exam.ruleTemplate) {
      case "medical":
      case "university":
        return 0.25;
      case "academic":
        return 0;
      default:
        break;
    }
  }
  if (exam.negativeEnabled === undefined) {
    // Legacy exams stored before the per-exam toggle keep the old rule.
    return negativeMarksFor(exam.courseType);
  }
  return exam.negativeEnabled ? Math.max(0, exam.negativePerWrong ?? 0.25) : 0;
}

/** Whether this exam's rule template enables negative marking. */
export function isNegativeEnabled(exam: {
  negativeEnabled?: boolean;
  ruleTemplate?: string | null;
  courseType: string;
}): boolean {
  if (exam.ruleTemplate) return exam.ruleTemplate === "medical" || exam.ruleTemplate === "university";
  if (exam.negativeEnabled !== undefined) return Boolean(exam.negativeEnabled);
  return exam.courseType === "Admission";
}

/** Resolve second-timer config from rule template or stored flags. */
export function secondTimerConfigFor(exam: {
  secondTimerEnabled?: boolean;
  secondTimerDeduction?: number;
  ruleTemplate?: string | null;
}): { enabled: boolean; deduction: number } {
  if (exam.ruleTemplate) {
    if (exam.ruleTemplate === "medical") return { enabled: true, deduction: 3 };
    // academic and university both have no second timer per Spec §17
    return { enabled: false, deduction: 0 };
  }
  const enabled = Boolean(exam.secondTimerEnabled);
  const deduction = enabled && exam.secondTimerDeduction != null && exam.secondTimerDeduction > 0 ? Number(exam.secondTimerDeduction) : 0;
  return { enabled, deduction: enabled ? deduction || 3 : 0 };
}

export type TakingQuestion = {
  id: number;
  question: string;
  options: string[];
  marks: number;
  /** Optional per-question image (question_image column). */
  questionImage?: string | null;
};

export type SubmissionOutcome = {
  score: number;
  totalMarks: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  negativeMarks?: number;
  negativeDeduction?: number;
  /** Second-timer penalty applied (marks). 0 when OFF / first attempt. */
  timerPenalty?: number;
  /** True when this submission counted as a repeat attempt of the same exam. */
  secondTimer?: boolean;
  /** Sum of marks earned from correct answers alone (before deductions). */
  rawMarks?: number;
  meritPosition?: number | null;
  timeTakenSeconds?: number | null;
  /** Best score achieved by any student on this exam. */
  highestMark?: number | null;
  examName?: string;
  autoSubmitted?: boolean;
};

type ResultDetail = {
  questionId: number;
  chosenIndex: number | null;
  /** NULL = unknown answer (never defaulted to 0/A; cannot award marks). */
  correctIndex: number | null;
  marks: number;
  /** Marks obtained for this question — negative when a wrong answer costs marks. */
  obtained: number;
};

/** Best score achieved by any student on this exam (null when no results). */
async function highestMarkFor(examId: string): Promise<number | null> {
  try {
    // Practice attempts are unranked and must never become the leaderboard
    // highest: only official (scheduled) attempts count. Legacy rows without
    // attempt_type are treated as scheduled.
    try {
      const liveRows = await query<{ best: string | number | null }[]>(
        `SELECT MAX(score) AS best FROM exam_results WHERE exam_id = ? AND (attempt_type = 'scheduled' OR attempt_type IS NULL)`,
        [examId],
      );
      const best = liveRows[0]?.best;
      if (best !== null && best !== undefined) return Number(best);
    } catch {}
    // Fallback to all when the attempt_type column is missing (legacy DB).
    const rows = await query<{ best: string | number | null }[]>(
      `SELECT MAX(score) AS best FROM exam_results WHERE exam_id = ?`,
      [examId],
    );
    const best = rows[0]?.best;
    return best === null || best === undefined ? null : Number(best);
  } catch {
    return null;
  }
}

/**
 * Merit positions for every result of an exam. Ranking: higher score first;
 * on equal marks the student who took less time ranks higher; still tied,
 * the earlier submission wins.
 * Uses idx_exam_results_ranking (exam_id, score, time_taken_seconds, submitted_at)
 * and caps to 5000 rows per run to bound work for large exams.
 *
 * Flow 4 Exam Batch: only LIVE attempts are ranked. Practice attempts
 * (attempt_type='practice', after Live window) keep merit_position NULL
 * and never shift the frozen Live leaderboard.
 */
async function updateMeritPositions(examId: string): Promise<void> {
  try {
    // Auto-ensure attempt_type column exists (best-effort, no error if missing).
    try { await ensureColumn("exam_results", "attempt_type", "`attempt_type` ENUM('scheduled','practice') NOT NULL DEFAULT 'scheduled'"); } catch {}
    await withTransaction(async (connection) => {
      // For legacy rows (no attempt_type) treat as scheduled. Practice attempts excluded.
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM exam_results
         WHERE exam_id = ?
           AND (attempt_type = 'scheduled' OR attempt_type IS NULL)
         ORDER BY score DESC,
                  COALESCE(time_taken_seconds, 2147483647) ASC,
                  submitted_at ASC
         LIMIT 5000`,
        [examId],
      );
      const ranked = rows as unknown as { id: number }[];
      for (const [index, row] of ranked.entries()) {
        await connection.query(`UPDATE exam_results SET merit_position = ? WHERE id = ?`, [
          index + 1,
          row.id,
        ]);
      }
      // Practice attempts must stay unranked (NULL) so historic Live ranking freezes.
      try {
        await connection.query(`UPDATE exam_results SET merit_position = NULL WHERE exam_id = ? AND attempt_type = 'practice'`, [examId]);
      } catch {}
    });
  } catch {
    // Merit computation is best-effort; the stored result stays valid.
  }
}

type GradingQuestionRow = {
  id: number;
  /** NULL = unknown answer (never defaulted to 0/A; cannot award marks). */
  correct_index: number | null;
  marks: string | number;
};

type AttemptRow = {
  session_token: string;
  status: string;
  started_at?: Date | string | null;
  /** Fixed server-side expiration: started_at + duration. Never reset on resume. */
  expires_at?: Date | string | null;
  /** When the attempt was finalized (manual or auto). */
  submitted_at?: Date | string | null;
  timer_type?: string | null;
  /** Locked at start: student's chosen language version. */
  question_version?: string | null;
  /** Locked at start: server-assigned Set A/B (never client-chosen). */
  assigned_set?: string | null;
  /** Locked at start: shuffled permanent Question IDs in display order. */
  question_order?: string | number[] | null;
  /** Last client heartbeat — informational only, NEVER a submit trigger. */
  last_seen?: Date | string | null;
};

/**
 * FIXED server-side expiration model (production-safe):
 * - expires_at = started_at + duration_seconds, set once at creation.
 * - Refresh / disconnect / close / tab-switch NEVER change expires_at.
 * - Only current_time >= expires_at triggers auto-submit (lazy on access).
 * - last_seen silence NEVER submits — it only records activity.
 */
export const ATTEMPT_ABANDON_AFTER_SEC = 120;

/** True when last_seen exists and is older than the abandon threshold. */
function isAttemptAbandoned(lastSeen: AttemptRow["last_seen"]): boolean {
  void lastSeen;
  // DISABLED by design: silence (closed tab / offline / hidden) must NEVER
  // auto-submit. Only expires_at governs expiration. Kept as a stub so old
  // call-sites compile; all expiration paths use isAttemptExpired().
  return false;
}

/** Parse expires_at / started_at into ms; null when unparseable. */
function attemptTimeMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** True when server now >= expires_at (or started_at+duration fallback). */
function isAttemptExpired(
  attempt: Pick<AttemptRow, "started_at" | "expires_at">,
  durationMinutes: number,
  nowMs = Date.now(),
): boolean {
  const exp = attemptTimeMs(attempt.expires_at);
  if (exp !== null) return nowMs >= exp;
  const start = attemptTimeMs(attempt.started_at);
  if (start === null) return false;
  return nowMs >= start + durationMinutes * 60 * 1000;
}

/** Authoritative remaining seconds: expires_at - server_now (floor, >=0). */
function remainingSecFor(
  attempt: Pick<AttemptRow, "started_at" | "expires_at">,
  durationMinutes: number,
  nowMs = Date.now(),
): number {
  const exp = attemptTimeMs(attempt.expires_at) ?? (() => {
    const start = attemptTimeMs(attempt.started_at);
    return start === null ? null : start + durationMinutes * 60 * 1000;
  })();
  if (exp === null) return durationMinutes * 60;
  return Math.max(0, Math.floor((exp - nowMs) / 1000));
}

/** ISO string for expires_at given a start ms + duration. */
function expiresIsoFor(startMs: number, durationMinutes: number): string {
  return new Date(startMs + durationMinutes * 60 * 1000).toISOString();
}

/** Parse the locked question_order JSON into an array of permanent IDs. */
function parseLockedOrder(value: AttemptRow["question_order"]): number[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const ids = (value as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ids.length > 0 ? ids : null;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const ids = (parsed as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        return ids.length > 0 ? ids : null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Read the locked version/set/order for an active attempt (null when none). */
async function readAttemptLock(
  examId: string,
  uid: string,
): Promise<{ version: QuestionVersion; set: QuestionSet; order: number[] } | null> {
  try {
    await ensureVariantTables();
    const rows = await query<AttemptRow[]>(
      `SELECT session_token, status, question_version, assigned_set, question_order
         FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const attempt = rows[0];
    if (!attempt || attempt.status !== "active") return null;
    const version = normalizeVersion(attempt.question_version) ?? "bangla";
    const set: QuestionSet = attempt.assigned_set === "B" ? "B" : "A";
    const order = parseLockedOrder(attempt.question_order);
    if (!order) return null;
    return { version, set, order };
  } catch {
    return null;
  }
}

/**
 * Backfill the version/set/order lock for an active attempt that started
 * before this system existed (or whose lock columns are empty). Runs once —
 * afterwards the attempt carries a permanent lock like any other.
 */
async function backfillAttemptLock(
  examId: string,
  uid: string,
  questionVersion: QuestionVersion,
): Promise<void> {
  try {
    await ensureVariantTables();
    // Availability-aware: a single fully-authored Set is reused as-is so a
    // resumed legacy attempt can never land on an unavailable Set.
    const assignedSet = await assignSetForExam(examId, questionVersion);
    const idRows = await query<{ id: number }[]>(
      `SELECT id FROM exam_questions WHERE exam_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
      [examId],
    );
    const order = shuffledOrder(idRows.map((r) => Number(r.id)));
    await exec(
      `UPDATE exam_attempts SET question_version = ?, assigned_set = ?, question_order = ?, last_seen = CURRENT_TIMESTAMP
        WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
      [questionVersion, assignedSet, JSON.stringify(order), examId, uid],
    );
  } catch {
    // Best effort — grading falls back to base rows when no lock exists.
  }
}

/**
 * Backfill fixed expires_at for legacy active attempts:
 * expires_at = started_at + duration. Never touches started_at.
 */
async function backfillExpiresAt(examId: string, uid: string): Promise<void> {
  try {
    const { fetchExamById } = await import("@/lib/exams-admin");
    const exam = await fetchExamById(examId);
    const dur = exam?.durationMinutes ?? 30;
    const rows = await query<{ started_at: Date | string | null; expires_at: Date | string | null }[]>(
      `SELECT started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const r = rows[0];
    if (!r || r.expires_at) return;
    const startMs = attemptTimeMs(r.started_at) ?? Date.now();
    const expIso = expiresIsoFor(startMs, dur);
    await exec(
      `UPDATE exam_attempts SET expires_at = ? WHERE exam_id = ? AND student_uid = ? AND status = 'active' AND expires_at IS NULL`,
      [expIso, examId, uid],
    );
  } catch {}
}

function isLivePublished(exam: Exam): boolean {
  return exam.status === "published";
}

/**
 * True when a public live-mode exam is past its configured End Time, i.e. in
 * the automatic post-live Practice Exam phase (Upcoming → Live → Practice).
 * Attempts started in this phase are recorded with attempt_type='practice':
 * fully completable with their own result, but never ranked.
 */
async function isPostLivePracticeExam(exam: Exam): Promise<boolean> {
  try {
    const { isPublicPostLivePractice } = await import("@/lib/exam-lifecycle");
    return isPublicPostLivePractice(exam);
  } catch {
    return false;
  }
}

let attemptTablesReady: Promise<void> | null = null;
function ensureAttemptTables(): Promise<void> {
  if (!attemptTablesReady) {
    attemptTablesReady = (async () => {
      await exec(`CREATE TABLE IF NOT EXISTS exam_attempts (
        exam_id VARCHAR(64) NOT NULL,
        student_uid VARCHAR(191) NOT NULL,
        session_token VARCHAR(64) NOT NULL,
        status ENUM('active','submitted') NOT NULL DEFAULT 'active',
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (exam_id, student_uid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await exec(`CREATE TABLE IF NOT EXISTS exam_attempt_answers (
        exam_id VARCHAR(64) NOT NULL,
        student_uid VARCHAR(191) NOT NULL,
        question_id BIGINT UNSIGNED NOT NULL,
        option_index INT NOT NULL,
        answered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (exam_id, student_uid, question_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // Timer Type selection — student chooses First or Second Timer on Rules page.
      // Stored per active attempt and used for grading; locked after start.
      try {
        await ensureColumn("exam_attempts", "timer_type", "`timer_type` ENUM('first','second') NULL AFTER status");
      } catch {
        // Best effort — column may already exist or table not yet ready.
      }
      // Language Version + Set A/B + Question Order lock (exam-variants.ts).
      // Auto-created here as well so legacy DBs work without running migrations.
      try {
        await ensureVariantTables();
      } catch {
        // Best effort — variant Lock is applied on next attempt start.
      }
      // Client heartbeat for abandoned-session detection (close/leave → auto-submit).
      try {
        await ensureColumn("exam_attempts", "last_seen", "`last_seen` TIMESTAMP NULL DEFAULT NULL");
      } catch {
        // Best effort — abandon detection is skipped when the column is missing.
      }
      // Fixed server-side expiration (source of truth). Set once at creation,
      // never changed on resume/refresh/reconnect.
      try {
        await ensureColumn("exam_attempts", "expires_at", "`expires_at` TIMESTAMP NULL DEFAULT NULL");
      } catch {}
      try {
        await ensureColumn("exam_attempts", "submitted_at", "`submitted_at` TIMESTAMP NULL DEFAULT NULL");
      } catch {}
      // Status vocabulary: active (=in_progress) + submitted + auto_submitted
      // + expired. Older DBs only have ('active','submitted'); expand
      // best-effort so lazy expiration can mark auto_submitted/expired.
      try {
        await exec(
          `ALTER TABLE exam_attempts MODIFY COLUMN status ENUM('active','submitted','auto_submitted','expired') NOT NULL DEFAULT 'active'`,
        );
      } catch {}
    })().catch((error) => {
      attemptTablesReady = null;
      throw error;
    });
  }
  return attemptTablesReady;
}

/**
 * Start or RESUME an attempt (server source of truth).
 * - ONE active attempt per (exam, student). Refresh / reconnect / reopen /
 *   second device returns the SAME attempt + SAME token + SAME expires_at.
 * - expires_at = started_at + duration, fixed at creation, never reset.
 * - Auto-submit ONLY when now >= expires_at (lazy finalize on access).
 * - last_seen silence / offline / hidden tab NEVER submits.
 */
async function startExamAttempt(
  examId: string,
  uid: string,
  studentName: string,
  timerType: "first" | "second" = "first",
  questionVersion: QuestionVersion = "bangla",
): Promise<string> {
  await ensureAttemptTables();
  const normalizedTimer: "first" | "second" = timerType === "second" ? "second" : "first";
  // One-attempt rule: Public Live + all Enrolled/Course exams (Live and Practice) allow max 1 attempt total. Public Practice exams are retakable per attempt rules (dynamic merit).
  try {
    const { fetchExamById } = await import("@/lib/exams-admin");
    const examForCheck = await fetchExamById(examId);
    const isPracticeMode = !!examForCheck && examForCheck.examMode === "practice";
    // Server-time lifecycle gate — reliable without any frontend timer.
    if (examForCheck) {
      if (examForCheck.kind === "enrolled") {
        const { getEnrolledExamPhase } = await import("@/lib/enrolled-exam-lifecycle");
        const phase = getEnrolledExamPhase(examForCheck);
        if (phase === "upcoming") {
          throw new Error("This exam has not started yet.");
        }
        // Live and Archived(practice) both allow start.
      } else if (!isPracticeMode) {
        const { getPublicLiveState } = await import("@/lib/exam-lifecycle");
        const state = getPublicLiveState(examForCheck);
        if (state === "upcoming" || state === "draft") {
          throw new Error("This exam has not started yet.");
        }
        if (state === "closed" || state === "hidden") {
          throw new Error("This exam has ended. You can no longer start it.");
        }
      }
    }
    if (!isPracticeMode || (examForCheck?.kind === "enrolled")) {
      // Post-live Practice phase + enrolled-archived (practice) phase: retakes
      // are allowed — every attempt after the live window is recorded as a
      // new unranked practice attempt (never returns the old live outcome).
      const isPostLivePractice = examForCheck
        ? await isPostLivePracticeExam(examForCheck).catch(() => false)
        : false;
      let isEnrolledPracticeRetake = false;
      try {
        const { getEnrolledExamPhase, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
        if (examForCheck && examForCheck.kind === "enrolled") {
          isEnrolledPracticeRetake = isEnrolledPracticePhase(getEnrolledExamPhase(examForCheck));
        }
      } catch {
        // Best-effort — keep default enforcement.
      }
      if (!isPostLivePractice && !isEnrolledPracticeRetake) {
        const hasCompleted = await hasPriorExamAttempt(examId, uid);
        if (hasCompleted) {
          throw new Error("You have already appeared in this exam. View your result.");
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && (e.message.includes("already appeared") || e.message.includes("not started") || e.message.includes("has ended"))) throw e;
    // If exam lookup fails, fall through to normal handling
  }
  // Max attempts enforcement: check exam_settings.maxAttempts if the table exists (for enrolled / fallback)
  // Enrolled Exam Practice is exempt — after Live ends, enrolled students may
  // retake for practice even when maxAttempts would otherwise block (spec §6).
  let bypassMaxAttempts = false;
  try {
    const { getEnrolledExamPhase, isEnrolledExam, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
    const { fetchExamById } = await import("@/lib/exams-admin");
    const examForPhase = await fetchExamById(examId);
    if (examForPhase && (await isEnrolledExam(examId))) {
      if (isEnrolledPracticePhase(getEnrolledExamPhase(examForPhase))) bypassMaxAttempts = true;
    }
  } catch {
    // Best-effort — keep default enforcement.
  }
  if (!bypassMaxAttempts) {
    try {
      const settingsRows = await query<{ max_attempts: number | string | null }[]>(
        `SELECT max_attempts FROM exam_settings WHERE id = 'active' LIMIT 1`,
      );
      const raw = settingsRows[0]?.max_attempts;
      const maxAttempts = raw !== null && raw !== undefined ? Number(raw) : null;
      if (maxAttempts !== null && Number.isFinite(maxAttempts) && maxAttempts > 0) {
        const countRows = await query<{ n: number }[]>(
          `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
          [examId, uid],
        );
        if ((countRows[0]?.n ?? 0) >= maxAttempts) {
          throw new Error(`Maximum attempts (${maxAttempts}) reached for this exam.`);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Maximum attempts")) throw e;
      if (e instanceof Error && e.message.includes("already appeared")) throw e;
      // If exam_settings missing or query fails, ignore and allow attempt.
    }
  }
  const existing = await query<AttemptRow[]>(
    `SELECT session_token, status, started_at, expires_at, question_version, assigned_set, question_order FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
    [examId, uid],
  );
  // DUPLICATE-ATTEMPT PREVENTION: any active attempt is resumed, never
  // replaced — for public AND enrolled exams alike. Refresh/re-entry hits
  // this path. Only an expired attempt is finalized (result shown).
  if (existing[0]?.status === "active") {
    // Backfill fixed expires_at for legacy attempts that predate the column.
    try {
      const needBackfill =
        !existing[0].expires_at || !existing[0].started_at;
      const lock = parseLockedOrder(existing[0].question_order);
      if (!lock || !normalizeVersion(existing[0].question_version)) {
        await backfillAttemptLock(examId, uid, questionVersion);
      } else if (needBackfill) {
        await backfillExpiresAt(examId, uid);
      }
    } catch {
      // Best effort — the take path re-reads state anyway.
    }
    // Re-read after backfill to decide resume vs expire.
    const cur = await query<AttemptRow[]>(
      `SELECT session_token, status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const active = cur[0];
    if (active?.status === "active") {
      try {
        const { fetchExamById } = await import("@/lib/exams-admin");
        const examForExpiry = await fetchExamById(examId);
        const dur = examForExpiry?.durationMinutes ?? 30;
        if (isAttemptExpired(active, dur)) {
          // Past expires_at → lazy auto-submit; caller shows result.
          await finalizeAttempt(examId, uid, studentName, {}, true);
          const done = await latestOutcome(examId, uid);
          if (done) throw new Error("Time is up. Your exam has been submitted automatically.");
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Time is up")) throw e;
      }
      // Still valid → resume same session/token/expiry. Touch last_seen only.
      try {
        await exec(
          `UPDATE exam_attempts SET last_seen = CURRENT_TIMESTAMP WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
          [examId, uid],
        );
      } catch {}
      const fresh = await query<AttemptRow[]>(
        `SELECT session_token FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
        [examId, uid],
      );
      return fresh[0]?.session_token ?? existing[0].session_token;
    }
  }
  // A finalized attempt (submitted/auto_submitted/expired) blocks a new one
  // unless retakes are explicitly allowed (checked above via hasPrior/maxAttempts).
  if (existing[0] && existing[0].status !== "active") {
    // Row exists but finalized and retake allowed (e.g. post-live practice):
    // fall through to create a fresh attempt below.
    void existing;
  }
  const token = randomUUID();
  // Server-side Set assignment + order shuffle, locked to this attempt.
  // Availability-aware: when only one Set holds complete valid questions it
  // is used directly; when both do, the existing random assignment applies.
  const assignedSet = await assignSetForExam(examId, questionVersion);
  let questionOrder: number[];
  try {
    const idRows = await query<{ id: number }[]>(
      `SELECT id FROM exam_questions WHERE exam_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
      [examId],
    );
    questionOrder = shuffledOrder(idRows.map((r) => Number(r.id)));
  } catch {
    questionOrder = [];
  }
  // Fixed expiration: expires_at = now + duration. Set ONCE here; resume
  // paths never touch started_at/expires_at.
  let durationMin = 30;
  try {
    const { fetchExamById } = await import("@/lib/exams-admin");
    const ex = await fetchExamById(examId);
    if (ex && Number.isFinite(ex.durationMinutes) && ex.durationMinutes > 0) durationMin = ex.durationMinutes;
  } catch {}
  const nowMs = Date.now();
  const startedIso = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
  const expiresIso = new Date(nowMs + durationMin * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  // Fresh attempt only (no active row at this point — guarded above).
  // Conditional insert: if a concurrent request created an active attempt,
  // keep the first one (no duplicate, no timer reset).
  try {
    await exec(
      `INSERT INTO exam_attempts (exam_id, student_uid, session_token, status, timer_type, question_version, assigned_set, question_order, last_seen, started_at, expires_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
       ON DUPLICATE KEY UPDATE session_token = IF(status = 'active', session_token, VALUES(session_token)), status = IF(status = 'active', status, VALUES(status)), timer_type = IF(status = 'active', timer_type, VALUES(timer_type)), question_version = IF(status = 'active', question_version, VALUES(question_version)), assigned_set = IF(status = 'active', assigned_set, VALUES(assigned_set)), question_order = IF(status = 'active', question_order, VALUES(question_order)), last_seen = CURRENT_TIMESTAMP, started_at = IF(status = 'active', started_at, VALUES(started_at)), expires_at = IF(status = 'active', expires_at, VALUES(expires_at))`,
      [examId, uid, token, normalizedTimer, questionVersion, assignedSet, JSON.stringify(questionOrder), startedIso, expiresIso],
    );
  } catch {
    await exec(
      `INSERT INTO exam_attempts (exam_id, student_uid, session_token, status, timer_type, question_version, assigned_set, question_order, last_seen, started_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE session_token = IF(status = 'active', session_token, VALUES(session_token)), status = IF(status = 'active', status, VALUES(status)), last_seen = CURRENT_TIMESTAMP`,
      [examId, uid, token, normalizedTimer, questionVersion, assignedSet, JSON.stringify(questionOrder)],
    );
  }
  // Read back the authoritative token (a concurrent starter may have won).
  // Only the owner of the current attempt may clear answers: a loser that
  // resumes the winner's active session must never wipe the winner's answers.
  try {
    const won = await query<AttemptRow[]>(
      `SELECT session_token FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    if (won[0]?.session_token && won[0].session_token !== token) {
      return won[0].session_token;
    }
  } catch {}
  // Fresh session owned by this caller — clear any leftover answers.
  await exec(
    `DELETE FROM exam_attempt_answers WHERE exam_id = ? AND student_uid = ?`,
    [examId, uid],
  );
  return token;
}

/**
 * Store one selection. Server-enforced "answer only once": the first
 * accepted answer for a question wins; later changes are rejected.
 * If the token no longer matches (another device took over), the graded
 * outcome of this terminated session is returned.
 */
export async function saveExamAnswer(
  examId: string,
  uid: string,
  studentName: string,
  token: string,
  questionId: number,
  optionIndex: number,
): Promise<{
  accepted: boolean;
  terminated?: boolean;
  outcome?: SubmissionOutcome;
  autoSubmitted?: boolean;
}> {
  await ensureAttemptTables();
  const attempts = await query<AttemptRow[]>(
    `SELECT session_token, status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
    [examId, uid],
  );
  const attempt = attempts[0];
  // Final states (submitted / auto_submitted / expired) → no more answers.
  // Return the stored outcome so the client shows the result.
  if (!attempt || attempt.status !== "active") {
    const outcome = await latestOutcome(examId, uid).catch(() => null);
    return { accepted: false, terminated: true, outcome: outcome ?? undefined };
  }
  // Same attempt resumed on another tab/device shares the token (resume
  // model). Only a truly different live session is impossible now — but keep
  // the guard: unknown token → show stored result, never overwrite.
  if (attempt.session_token !== token) {
    // Allow shared-attempt writes: if the caller holds a stale token but the
    // attempt is still the same logical session (started_at unchanged), treat
    // it as the same attempt. Otherwise terminate to result view.
    // Simplest safe rule: if attempt is active and not expired, accept the
    // answer regardless of token (multi-tab resume), and do NOT terminate.
    // Token mismatch no longer kills a session — expiry does.
    void studentName;
  }
  // Server-side expiry check — expires_at is authoritative (no grace games
  // beyond a 60s network-tolerance window so in-flight submits at 29:59 land).
  try {
    const exams = await fetchExams();
    const found = exams.find((e) => e.id === examId);
    if (found) {
      const nowMs = Date.now();
      const expMs = attemptTimeMs(attempt.expires_at);
      const startMs = attemptTimeMs(attempt.started_at);
      const effectiveExp = expMs ?? (startMs !== null ? startMs + found.durationMinutes * 60 * 1000 : null);
      if (effectiveExp !== null && nowMs >= effectiveExp + 60 * 1000) {
        const outcome = await finalizeAttempt(examId, uid, studentName, {}, true);
        if (outcome) {
          return {
            accepted: false,
            outcome: { ...outcome, autoSubmitted: true },
            autoSubmitted: true,
          };
        }
      } else if (effectiveExp !== null && nowMs >= effectiveExp) {
        // Within the 60s tolerance: still accept the answer write, but flag
        // expiry so the next submit finalizes as auto-submitted.
        void 0;
      }
    }
  } catch {
    // On error, fall through to normal handling
  }
  try {
    await exec(
      `INSERT INTO exam_attempt_answers (exam_id, student_uid, question_id, option_index)
       VALUES (?, ?, ?, ?)`,
      [examId, uid, questionId, optionIndex],
    );
    return { accepted: true };
  } catch {
    // Duplicate answer — locked after the first selection.
    return { accepted: false };
  }
}

async function fetchStoredAnswers(
  examId: string,
  uid: string,
): Promise<Record<string, number>> {
  const rows = await query<{ question_id: number | string; option_index: number }[]>(
    `SELECT question_id, option_index FROM exam_attempt_answers
     WHERE exam_id = ? AND student_uid = ?`,
    [examId, uid],
  );
  const answers: Record<string, number> = {};
  for (const row of rows) {
    answers[String(row.question_id)] = row.option_index;
  }
  return answers;
}

/** Grade stored (+ extra) answers with the negative-marking rule applied. */
function gradeAnswers(
  rows: GradingQuestionRow[],
  merged: Record<string, number>,
  negativePerWrong: number,
): Omit<SubmissionOutcome, "totalMarks"> & {
  totalMarks: number;
  details: ResultDetail[];
} {
  let score = 0;
  let rawMarks = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  const details: ResultDetail[] = [];

  for (const row of rows) {
    // Per-question lookup by permanent ID (String-coerced: stored snapshots
    // may key IDs as "123" while rows carry 123). Values are normalized —
    // numbers, numeric strings and A/B/C/D letters all resolve; anything
    // else stays unknown (null), never defaulted to 0/"A".
    const chosen = normalizeStoredAnswerIndex(merged[String(row.id)]);
    // Correct answer is normalized the same way (never confused with the
    // user's answer; malformed stays null and can never match).
    const correctIdx = normalizeStoredAnswerIndex(row.correct_index);
    const marks = Number(row.marks) || 1;
    if (chosen === null) {
      skippedCount += 1;
      details.push({
        questionId: row.id,
        chosenIndex: null,
        correctIndex: correctIdx,
        marks,
        obtained: 0,
      });
      continue;
    }
    if (correctIdx !== null && chosen === correctIdx) {
      score += marks;
      rawMarks += marks;
      correctCount += 1;
      details.push({
        questionId: row.id,
        chosenIndex: chosen,
        correctIndex: correctIdx,
        marks,
        obtained: marks,
      });
    } else {
      score -= negativePerWrong;
      wrongCount += 1;
      details.push({
        questionId: row.id,
        chosenIndex: chosen,
        correctIndex: correctIdx,
        marks,
        obtained: -negativePerWrong,
      });
    }
  }

  score = Math.max(0, Math.round(score * 100) / 100);
  const totalMarks =
    Math.round(rows.reduce((sum, row) => sum + (Number(row.marks) || 1), 0) * 100) /
    100;

  return {
    score,
    totalMarks,
    correctCount,
    wrongCount,
    skippedCount,
    rawMarks: Math.round(rawMarks * 100) / 100,
    negativeMarks: negativePerWrong,
    negativeDeduction:
      wrongCount > 0 && negativePerWrong > 0
        ? Math.round(negativePerWrong * wrongCount * 100) / 100
        : 0,
    details,
  };
}

/**
 * Close an attempt: grade stored (+ extra client) answers, persist the
 * result and mark the session submitted. Atomic: only one closer wins —
 * concurrent submit/expiry calls collapse into the stored result.
 * @param auto true when closed by expiration (status auto_submitted).
 */
async function finalizeAttempt(
  examId: string,
  uid: string,
  studentName: string,
  extraAnswers: Record<string, number>,
  auto = false,
): Promise<SubmissionOutcome | null> {
  const exams = await fetchExams();
  const found = exams.find((exam) => exam.id === examId);
  if (!found) return null;
  // One-attempt for live-window exams: a prior completed result is returned
  // as-is. Practice retakes (post-live Practice phase AND enrolled-archived
  // practice phase) are exempt — each practice attempt is graded and stored
  // as its own new unranked practice row, never the old live outcome.
  const isPostLivePracticeFinalize = await isPostLivePracticeExam(found).catch(() => false);
  let isEnrolledPracticeFinalize = false;
  try {
    const { getEnrolledExamPhase, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
    if (found.kind === "enrolled") {
      isEnrolledPracticeFinalize = isEnrolledPracticePhase(getEnrolledExamPhase(found));
    }
  } catch {
    // Best-effort — fall through to the live-window rule.
  }
  if (!isPostLivePracticeFinalize && !isEnrolledPracticeFinalize) {
    try {
      const hasCompleted = await hasPriorExamAttempt(examId, uid);
      if (hasCompleted) {
        const existing = await latestOutcome(examId, uid);
        if (existing) return existing;
      }
    } catch {
      // best-effort
    }
  }

  const stored = await fetchStoredAnswers(examId, uid);
  const merged: Record<string, number> = { ...extraAnswers };
  for (const [key, value] of Object.entries(stored)) {
    merged[key] = value;
  }

  // Grade against the student's locked Version/Set mapping (permanent
  // Question IDs). Falls back to base rows for legacy attempts without a lock.
  const lock = await readAttemptLock(examId, uid);
  let rows: GradingQuestionRow[];
  try {
    const baseRows = await query<
      { id: number; correct_index: number | null; marks: string | number }[]
    >(
      `SELECT id, correct_index, marks FROM exam_questions
       WHERE exam_id = ? AND is_active = 1`,
      [examId],
    );
    if (lock) {
      const variants = await fetchVariantMap(examId);
      const resolved = resolveQuestions(
        baseRows.map((r) => ({
          id: r.id,
          question: "",
          options: "[]",
          marks: r.marks,
          correct_index: r.correct_index,
          explanation: null,
        })),
        variants,
        lock.version,
        lock.set,
      );
      rows = resolved.map((q) => ({ id: q.id, correct_index: q.correctIndex, marks: q.marks }));
    } else {
      rows = baseRows;
    }
  } catch {
    rows = await query<GradingQuestionRow[]>(
      `SELECT id, correct_index, marks FROM exam_questions
       WHERE exam_id = ? AND is_active = 1`,
      [examId],
    );
  }

  const negativePerWrong = negativePerWrongFor(found);
  const graded = gradeAnswers(rows, merged, negativePerWrong);

  // Second-timer check — use student's selected Timer Type for this attempt (stored in exam_attempts.timer_type).
  // If enabled and student selected Second Timer, apply configured deduction; First Timer = no penalty.
  // Legacy attempts without timer_type fall back to prior-submission check for backward compatibility, but
  // new flow must NOT auto-apply penalty to every student — only when Second Timer is explicitly selected.
  let isSecondTimer = false;
  try {
    const timerRows = await query<{ timer_type: string | null }[]>(
      `SELECT timer_type FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const storedType = timerRows[0]?.timer_type ?? null;
    if (storedType === "second") {
      isSecondTimer = true;
    } else if (storedType === "first") {
      isSecondTimer = false;
    } else {
      // Legacy: no selection stored — treat as First Timer (no penalty) to avoid auto-deduction.
      // Prior logic (count >0) is intentionally NOT used for new Timer Type flow.
      isSecondTimer = false;
    }
  } catch {
    // On failure treat as first timer — never penalise without evidence.
  }
  const { enabled: secondEnabled, deduction: secondDeduction } = secondTimerConfigFor(found);
  const timerPenalty = secondEnabled && isSecondTimer ? secondDeduction : 0;

  // Final marks = raw (post-negative-marking) − second-timer penalty.
  const finalScore = Math.max(
    0,
    Math.round((graded.score - timerPenalty) * 100) / 100,
  );

  // Time taken = seconds between attempt start and submission (server clock).
  let timeTakenSeconds: number | null = null;
  try {
    const startedRows = await query<{ started_at: Date | string }[]>(
      `SELECT started_at FROM exam_attempts
       WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const startedRaw = startedRows[0]?.started_at;
    if (startedRaw) {
      const startedMs = new Date(startedRaw).getTime();
      if (!Number.isNaN(startedMs)) {
        timeTakenSeconds = Math.min(
          86400,
          Math.max(0, Math.round((Date.now() - startedMs) / 1000)),
        );
      }
    }
  } catch {
    // Fall back to null — merit tie-break then uses submission order.
  }

  await exec(
    `INSERT INTO exam_enrollments (exam_id, student_uid, student_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE student_name = VALUES(student_name)`,
    [examId, uid, studentName],
  );
  // Attempt typing — scheduled (official, ranked) vs practice (unranked, never
  // on the leaderboard). Enrolled exams: Archived submissions are practice.
  // Public exams: static practice-mode exams + post-live Practice phase are
  // both unranked practice attempts with their own result.
  let attemptType: "scheduled" | "practice" = "scheduled";
  try {
    const { getEnrolledExamPhase, isEnrolledExam, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
    const isEnrolled = await isEnrolledExam(examId);
    if (isEnrolled) {
      const phase = getEnrolledExamPhase(found);
      if (isEnrolledPracticePhase(phase)) attemptType = "practice";
    } else if ((found as { examMode?: string }).examMode === "practice") {
      // Static Practice Exam — student takes the exam normally, but the
      // attempt is unranked and never affects the official leaderboard.
      attemptType = "practice";
    } else if (await isPostLivePracticeExam(found).catch(() => false)) {
      // Public live-mode exam submitted after its End Time → unranked
      // practice attempt: it keeps its own result but gets merit_position
      // NULL and never shifts the frozen Live leaderboard.
      attemptType = "practice";
    }
  } catch {
    // Fallback to live on error — never block submission.
  }
  // Atomic claim FIRST: only the first closer flips active → final. The
  // exam_results insert below runs solely for the winner, so concurrent
  // submit/expiry calls can never double-insert.
  const finalStatus = auto ? "auto_submitted" : "submitted";
  let priorMaxId = 0;
  try {
    const maxRows = await query<{ maxId: number | null }[]>(
      `SELECT MAX(id) AS maxId FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
      [examId, uid],
    );
    priorMaxId = Number(maxRows[0]?.maxId) || 0;
  } catch {
    // Best-effort — loser falls back to a single latestOutcome read.
  }
  try {
    const res = (await exec(
      `UPDATE exam_attempts SET status = ?, submitted_at = CURRENT_TIMESTAMP WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
      [finalStatus, examId, uid],
    )) as unknown as { affectedRows?: number };
    if (res && typeof res.affectedRows === "number" && res.affectedRows === 0) {
      // Lost the race: wait briefly for the winner's insert, then return the
      // stored result instead of inserting a duplicate.
      for (let i = 0; i < 20; i++) {
        try {
          const latest = await query<{ maxId: number | null }[]>(
            `SELECT MAX(id) AS maxId FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
            [examId, uid],
          );
          if ((Number(latest[0]?.maxId) || 0) > priorMaxId) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      const existing = await latestOutcome(examId, uid);
      if (existing) return auto ? { ...existing, autoSubmitted: true } : existing;
      return null;
    }
  } catch {
    // Legacy DB without new enum values / submitted_at → fallback.
    try {
      await exec(
        `UPDATE exam_attempts SET status = 'submitted' WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
        [examId, uid],
      );
    } catch {}
  }
  // Insert with attempt_type when column exists; fallback without it for legacy DBs.
  // The locked Version/Set/Order snapshot travels with the result so the
  // answer script replays the student's own language version and order.
  const lockVersion = lock?.version ?? null;
  const lockSet = lock?.set ?? null;
  const lockOrderJson = lock ? JSON.stringify(lock.order) : null;
  try {
    try {
      await ensureColumn(
        "exam_results",
        "attempt_type",
        "`attempt_type` ENUM('scheduled','practice') NOT NULL DEFAULT 'scheduled'",
      );
    } catch {}
    try {
      await ensureVariantTables();
    } catch {}
    await exec(
      `INSERT INTO exam_results
         (exam_id, student_uid, student_name, score, total_marks, answers,
          details, time_taken_seconds, negative_deduction, timer_penalty,
          is_second_timer, attempt_type, question_version, assigned_set, question_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        examId,
        uid,
        studentName,
        finalScore,
        graded.totalMarks,
        JSON.stringify(merged),
        JSON.stringify(graded.details),
        timeTakenSeconds,
        graded.negativeDeduction ?? 0,
        timerPenalty,
        isSecondTimer ? 1 : 0,
        attemptType,
        lockVersion,
        lockSet,
        lockOrderJson,
      ],
    );
  } catch {
    // Column missing or insertion failed — retry without version/set/order snapshot.
    try {
      await exec(
        `INSERT INTO exam_results
           (exam_id, student_uid, student_name, score, total_marks, answers,
            details, time_taken_seconds, negative_deduction, timer_penalty,
            is_second_timer, attempt_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          examId,
          uid,
          studentName,
          finalScore,
          graded.totalMarks,
          JSON.stringify(merged),
          JSON.stringify(graded.details),
          timeTakenSeconds,
          graded.negativeDeduction ?? 0,
          timerPenalty,
          isSecondTimer ? 1 : 0,
          attemptType,
        ],
      );
    } catch {
      // Column missing or insertion failed — retry without attempt_type (legacy).
      await exec(
        `INSERT INTO exam_results
           (exam_id, student_uid, student_name, score, total_marks, answers,
            details, time_taken_seconds, negative_deduction, timer_penalty,
            is_second_timer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          examId,
          uid,
          studentName,
          finalScore,
          graded.totalMarks,
          JSON.stringify(merged),
          JSON.stringify(graded.details),
          timeTakenSeconds,
          graded.negativeDeduction ?? 0,
          timerPenalty,
          isSecondTimer ? 1 : 0,
        ],
      );
    }
  }
  await updateMeritPositions(examId);
  await exec(
    `DELETE FROM exam_attempt_answers WHERE exam_id = ? AND student_uid = ?`,
    [examId, uid],
  );

  let meritPosition: number | null = null;
  try {
    const positionRows = await query<{ merit_position: number | null }[]>(
      `SELECT merit_position FROM exam_results
       WHERE exam_id = ? AND student_uid = ?
       ORDER BY id DESC LIMIT 1`,
      [examId, uid],
    );
    meritPosition = positionRows[0]?.merit_position ?? null;
  } catch {
    // Leave null on failure.
  }

  return {
    ...graded,
    score: finalScore,
    timerPenalty,
    secondTimer: isSecondTimer,
    meritPosition,
    timeTakenSeconds,
    examName: found.title,
    highestMark: await highestMarkFor(examId),
  };
}

/** Rebuild the outcome of the most recent stored result for this student. */
async function latestOutcome(
  examId: string,
  uid: string,
): Promise<SubmissionOutcome | null> {
  const rows = await query<
    {
      score: string | number;
      total_marks: string | number;
      merit_position: number | null;
      time_taken_seconds: number | null;
      negative_deduction: string | number | null;
      timer_penalty: string | number | null;
      is_second_timer: number | null;
    }[]
  >(
    `SELECT score, total_marks, merit_position, time_taken_seconds,
            negative_deduction, timer_penalty, is_second_timer
     FROM exam_results
     WHERE exam_id = ? AND student_uid = ? ORDER BY id DESC LIMIT 1`,
    [examId, uid],
  );
  const row = rows[0];
  if (!row) return null;
  const exams = await fetchExams();
  const found = exams.find((exam) => exam.id === examId);
  const questions = await query<GradingQuestionRow[]>(
    `SELECT id, correct_index, marks FROM exam_questions WHERE exam_id = ? AND is_active = 1`,
    [examId],
  );
  // Counts come from the last stored answers snapshot when available.
  // Correctness is evaluated against the locked Version/Set mapping stored
  // with the result (permanent Question IDs) — never the display serial.
  const resultRows = await query<{
    answers: string | null;
    question_version?: string | null;
    assigned_set?: string | null;
  }[]>(
    `SELECT answers, question_version, assigned_set FROM exam_results WHERE exam_id = ? AND student_uid = ?
     ORDER BY id DESC LIMIT 1`,
    [examId, uid],
  ).catch(async () => {
    // Legacy DBs without the snapshot columns.
    const legacy = await query<{ answers: string | null }[]>(
      `SELECT answers FROM exam_results WHERE exam_id = ? AND student_uid = ?
       ORDER BY id DESC LIMIT 1`,
      [examId, uid],
    );
    return legacy as { answers: string | null; question_version?: string | null; assigned_set?: string | null }[];
  });
  // Counts come from the last stored answers snapshot when available.
  // Correctness is evaluated against the locked Version/Set mapping stored
  // with the result (permanent Question IDs) — never the display serial.
  // Unknown answers stay unknown (NULL) — never coerced to 0/A.
  const correctById = new Map<number, number | null>();
  for (const q of questions) {
    const base = q.correct_index;
    correctById.set(Number(q.id), base === null || base === undefined ? null : base);
  }
  try {
    const snapVersion = normalizeVersion(resultRows[0]?.question_version);
    const snapSetRaw = String(resultRows[0]?.assigned_set ?? "").toUpperCase();
    const snapSet: QuestionSet | null = snapSetRaw === "B" ? "B" : snapSetRaw === "A" ? "A" : null;
    if (snapVersion && snapSet) {
      const variants = await fetchVariantMap(examId);
      for (const q of questions) {
        const v = variants.get(`${Number(q.id)}:${snapVersion}:${snapSet}`);
        if (v) {
          correctById.set(
            Number(q.id),
            v.correct_index === null || v.correct_index === undefined
              ? null
              : (Number.isFinite(Number(v.correct_index)) ? Number(v.correct_index) : null),
          );
        }
      }
    }
  } catch {
    // Fall back to base correct answers.
  }
  const parsed = parseJsonColumn<Record<string, number>>(resultRows[0]?.answers);
  const answers = parsed && typeof parsed === "object" ? parsed : {};
  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  let rawMarks = 0;
  for (const question of questions) {
    // String-keyed per-question lookup ("123" and 123 resolve identically);
    // numeric strings / letters normalize, malformed stays unknown (null).
    const chosen = normalizeStoredAnswerIndex(answers[String(question.id)]);
    // `.has()` (not `??`): an explicit stored unknown (NULL) must survive —
    // `null ?? fallback` would wrongly fall through to the base value.
    const correctIndex = normalizeStoredAnswerIndex(
      correctById.has(Number(question.id))
        ? (correctById.get(Number(question.id)) ?? null)
        : (question.correct_index ?? null),
    );
    if (chosen === null) skippedCount += 1;
    else if (correctIndex !== null && chosen === correctIndex) {
      correctCount += 1;
      rawMarks += Number(question.marks) || 1;
    } else wrongCount += 1;
  }
  const negativePerWrong = negativePerWrongFor(
    found ?? { courseType: "Academic" },
  );
  const score = Number(row.score) || 0;
  const timerPenalty = toNum(row.timer_penalty);
  return {
    score,
    totalMarks: Number(row.total_marks) || 0,
    correctCount,
    wrongCount,
    skippedCount,
    rawMarks: Math.round(rawMarks * 100) / 100,
    negativeMarks: negativePerWrong,
    negativeDeduction:
      row.negative_deduction !== null && row.negative_deduction !== undefined
        ? toNum(row.negative_deduction)
        : wrongCount > 0 && negativePerWrong > 0
          ? Math.round(negativePerWrong * wrongCount * 100) / 100
          : 0,
    timerPenalty,
    secondTimer: (row.is_second_timer ?? 0) === 1,
    examName: found?.title ?? undefined,
    meritPosition: row.merit_position ?? null,
    timeTakenSeconds: row.time_taken_seconds ?? null,
    highestMark: await highestMarkFor(examId),
  };
}

function toNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Check if a student has any prior submitted result for this exam.
 * Used by the Timer Selection page to determine first vs second timer.
 */
export async function hasPriorExamAttempt(
  examId: string,
  uid: string,
): Promise<boolean> {
  try {
    const rows = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM exam_results WHERE exam_id = ? AND student_uid = ?`,
      [examId, uid],
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function getExamForTaking(
  examId: string,
  uid?: string,
  studentName?: string,
  /** Only true once the student accepts the exam rules — begins the attempt. */
  startAttempt = false,
  timerType: "first" | "second" = "first",
  /** Student-chosen language version from the Rules page (locked after start). */
  questionVersionParam: unknown = "bangla",
): Promise<{
  exam: TakingExam;
  questions: TakingQuestion[];
  sessionToken: string | null;
  secondsLeft: number | null;
  startedAt: string | null;
  /** Locked version for this attempt (echo of the student's selection). Set/order stay server-side. */
  questionVersion: QuestionVersion | null;
  /** Present when re-entering found the session expired — auto-submitted, show the result. */
  abandonedOutcome?: SubmissionOutcome | null;
  /** Fixed server-side expiration (ISO). Client countdown derives from this. */
  expiresAt?: string | null;
  /** Server clock at response time (ISO) — client uses it to offset device clock. */
  serverNow?: string | null;
  /** Attempt status: active (=in_progress) when resumable. */
  attemptStatus?: string | null;
  /** Previously saved answers keyed by questionId — restored on refresh. */
  storedAnswers?: Record<string, number>;
} | null> {
  // Direct ID lookup — never via cached fetchExams list. Ensures the exact
  // published exam selected on Live Website is resolved, with no stale cache
  // or category/batch filtering mismatches.
  const { fetchExamById } = await import("@/lib/exams-admin");
  const found = await fetchExamById(examId);
  if (!found || !isLivePublished(found)) return null;
  // Enrolled exams are only visible to students enrolled in an assigned course.
  if (found.kind === "enrolled") {
    if (!uid || !(await hasEnrolledExamAccess(examId, uid))) return null;
  }

  const requestedVersion = normalizeVersion(questionVersionParam) ?? "bangla";

  const baseRows = await query<
    {
      id: number;
      question: string;
      options: string;
      marks: string | number;
      correct_index: number | null;
      explanation: string | null;
      question_image?: string | null;
      sort_order?: number | null;
    }[]
  >(
    `SELECT id, question, options, marks, correct_index, explanation, question_image, sort_order FROM exam_questions
      WHERE exam_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC`,
    [examId],
  );
  const variantMap = await fetchVariantMap(examId);

  // Permanent-ID keyed admin-order resolution (used for preview + grading base).
  const toTaking = (resolved: ResolvedQuestion[]): TakingQuestion[] =>
    resolved.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      marks: q.marks,
      questionImage: q.questionImage ?? null,
    }));

  /** Apply a locked shuffled order of permanent IDs; unknown/new IDs appended in admin order. */
  const applyLockedOrder = (
    resolved: ResolvedQuestion[],
    order: number[] | null,
  ): ResolvedQuestion[] => {
    if (!order || order.length === 0) return resolved;
    const byId = new Map(resolved.map((q) => [q.id, q]));
    const out: ResolvedQuestion[] = [];
    const seen = new Set<number>();
    for (const id of order) {
      const q = byId.get(Number(id));
      if (q && !seen.has(q.id)) {
        out.push(q);
        seen.add(q.id);
      }
    }
    for (const q of resolved) {
      if (!seen.has(q.id)) out.push(q);
    }
    return out;
  };

  // Preview (no attempt yet): base content in admin order. Variant content is
  // NEVER exposed before the attempt starts — the locked set is served only
  // after start / on resume of an active attempt.
  const previewResolved: ResolvedQuestion[] = [];
  for (const row of baseRows) {
    const parsed = parseJsonColumn<unknown[]>(row.options);
    if (Array.isArray(parsed)) {
      previewResolved.push({
        id: Number(row.id),
        question: row.question,
        options: parsed.map(String),
        marks: resolveMarks(row.marks, 1),
        // Preserve an explicit unknown (NULL) — never coerce it to 0/A.
        correctIndex: normalizeStoredAnswerIndex(row.correct_index),
        explanation: row.explanation ?? null,
        questionImage: (row.question_image as string | null) ?? null,
        fromVariant: false,
        hasVariant: false,
      });
    }
  }
  let questions: TakingQuestion[] = toTaking(previewResolved);
  let lockedVersion: QuestionVersion | null = null;

  let secondsLeft: number | null = null;
  let startedAt: string | null = null;
  let sessionToken: string | null = null;
  let abandonedOutcome: SubmissionOutcome | null = null;
  let expiresAt: string | null = null;
  let serverNow: string | null = new Date().toISOString();
  let attemptStatus: string | null = null;
  let storedAnswers: Record<string, number> = {};

  /** Hydrate locked questions + fixed expiry + stored answers for an active row. */
  const hydrateActive = async (
    attempt: AttemptRow & { started_at?: Date | string | null; expires_at?: Date | string | null },
  ) => {
    let lock = await readAttemptLock(examId, uid as string);
    if (!lock) {
      await backfillAttemptLock(examId, uid as string, requestedVersion);
      lock = await readAttemptLock(examId, uid as string);
    }
    if (lock) {
      lockedVersion = lock.version;
      const resolved = resolveQuestions(baseRows, variantMap, lock.version, lock.set);
      questions = toTaking(applyLockedOrder(resolved, lock.order));
    }
    // Ensure fixed expires_at exists (legacy backfill, never resets timer).
    await backfillExpiresAt(examId, uid as string);
    const rows = await query<AttemptRow[]>(
      `SELECT session_token, status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid as string],
    );
    const cur = rows[0];
    if (!cur) return;
    const startMs = attemptTimeMs(cur.started_at);
    let expMs = attemptTimeMs(cur.expires_at);
    if (expMs === null && startMs !== null) expMs = startMs + found.durationMinutes * 60 * 1000;
    if (startMs !== null) startedAt = new Date(startMs).toISOString();
    if (expMs !== null) expiresAt = new Date(expMs).toISOString();
    serverNow = new Date().toISOString();
    secondsLeft = remainingSecFor(cur, found.durationMinutes);
    sessionToken = cur.session_token ?? null;
    attemptStatus = cur.status ?? "active";
    try {
      storedAnswers = await fetchStoredAnswers(examId, uid as string);
    } catch {
      storedAnswers = {};
    }
  };

  if (uid) {
    try {
      await ensureAttemptTables();
      if (startAttempt && baseRows.length > 0) {
        try {
          sessionToken = await startExamAttempt(examId, uid, studentName || "Student", timerType, requestedVersion);
        } catch (e) {
          // Expired during start → lazy auto-submit already ran; surface result.
          if (e instanceof Error && e.message.startsWith("Time is up")) {
            abandonedOutcome = await latestOutcome(examId, uid);
            if (abandonedOutcome) abandonedOutcome = { ...abandonedOutcome, autoSubmitted: true };
            questions = [];
            secondsLeft = 0;
            startedAt = null;
            sessionToken = null;
            attemptStatus = "expired";
            serverNow = new Date().toISOString();
          } else {
            throw e;
          }
        }
        if (!abandonedOutcome) {
          const lock = await readAttemptLock(examId, uid);
          if (lock) {
            lockedVersion = lock.version;
            const resolved = resolveQuestions(baseRows, variantMap, lock.version, lock.set);
            questions = toTaking(applyLockedOrder(resolved, lock.order));
          } else {
            // Legacy fallback — admin order, requested version content.
            const resolved = resolveQuestions(baseRows, variantMap, requestedVersion, "A");
            questions = toTaking(resolved);
            lockedVersion = requestedVersion;
          }
          await backfillExpiresAt(examId, uid);
          try {
            const rows = await query<AttemptRow[]>(
              `SELECT session_token, status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
              [examId, uid],
            );
            const cur = rows[0];
            const startMs = attemptTimeMs(cur?.started_at);
            let expMs = attemptTimeMs(cur?.expires_at);
            if (expMs === null && startMs !== null) expMs = startMs + found.durationMinutes * 60 * 1000;
            if (startMs !== null) startedAt = new Date(startMs).toISOString();
            if (expMs !== null) expiresAt = new Date(expMs).toISOString();
            serverNow = new Date().toISOString();
            secondsLeft = cur ? remainingSecFor(cur, found.durationMinutes) : found.durationMinutes * 60;
            sessionToken = cur?.session_token ?? sessionToken;
            attemptStatus = cur?.status ?? "active";
            try {
              storedAnswers = await fetchStoredAnswers(examId, uid);
            } catch {
              storedAnswers = {};
            }
            // Started but already past expiry (returned after 31 min) →
            // finalize now and show result instead of reopening.
            if (cur && cur.status === "active" && isAttemptExpired(cur, found.durationMinutes)) {
              const outcome = await finalizeAttempt(examId, uid, studentName || "Student", {}, true);
              if (outcome) {
                abandonedOutcome = { ...outcome, autoSubmitted: true };
                questions = [];
                secondsLeft = 0;
                startedAt = null;
                sessionToken = null;
                attemptStatus = "expired";
                storedAnswers = {};
              }
            }
          } catch {
            // fall back to full duration display
          }
        }
      } else {
        // Re-entering without ?start=1: lazy-expiry ONLY. Silence/offline/
        // refresh NEVER finalizes — only now >= expires_at does.
        abandonedOutcome = await finalizeAbandonedAttempt(examId, uid, studentName || "Student");
        if (abandonedOutcome) {
          questions = [];
          secondsLeft = 0;
          startedAt = null;
          sessionToken = null;
          attemptStatus = "expired";
          storedAnswers = {};
          serverNow = new Date().toISOString();
        } else {
          const attemptRows = await query<AttemptRow[]>(
            `SELECT session_token, status, started_at, expires_at, question_version, assigned_set, question_order FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
            [examId, uid],
          );
          const attempt = attemptRows[0];
          if (attempt?.status === "active") {
            // Expired while away? Finalize and show result.
            if (isAttemptExpired(attempt, found.durationMinutes)) {
              const outcome = await finalizeAttempt(examId, uid, studentName || "Student", {}, true);
              if (outcome) {
                abandonedOutcome = { ...outcome, autoSubmitted: true };
                questions = [];
                secondsLeft = 0;
                startedAt = null;
                sessionToken = null;
                attemptStatus = "expired";
                storedAnswers = {};
                serverNow = new Date().toISOString();
              }
            } else {
              await hydrateActive(attempt);
            }
          }
        } // end resume
      }
    } catch {
      // On DB errors, fall back to default (null timer)
    }
  }

  // Enrolled exam phase for labeling (Live vs Practice after End Time). Computed server-side.
  // Public post-live Practice phase likewise computed server-side so the
  // client can allow practice retakes after the live window ends.
  let phase: TakingExam["phase"] = null;
  let isEnrolled = false;
  let isPostLivePractice = false;
  try {
    const { getEnrolledExamPhase, isEnrolledExam } = await import("@/lib/enrolled-exam-lifecycle");
    isEnrolled = await isEnrolledExam(examId);
    if (isEnrolled) phase = getEnrolledExamPhase(found);
    else phase = null;
  } catch {
    phase = null;
  }
  try {
    isPostLivePractice = await isPostLivePracticeExam(found).catch(() => false);
  } catch {
    isPostLivePractice = false;
  }
  return {
    exam: {
      id: found.id,
      title: found.title,
      subject: found.subject,
      batchId: found.batchId,
      courseType: found.courseType,
      durationMinutes: found.durationMinutes,
      totalMarks: questions.reduce((sum, item) => sum + item.marks, 0),
      // Per-exam Admin setting — 0 when negative marking is OFF.
      negativeMarks: negativePerWrongFor(found),
      startedAt,
      phase,
      isPostLivePractice,
      isFlow4: isEnrolled,
    },
    questions,
    sessionToken,
    secondsLeft,
    startedAt,
    questionVersion: lockedVersion,
    abandonedOutcome,
    expiresAt,
    serverNow,
    attemptStatus,
    storedAnswers,
  };
}

/**
 * Lazy expiration ONLY: finalize when now >= expires_at (fixed server time).
 * Silence / offline / hidden tab / refresh NEVER finalizes. Returns the
 * auto-submitted outcome when it expired, else null (attempt still live).
 */
export async function finalizeAbandonedAttempt(
  examId: string,
  uid: string,
  studentName: string,
): Promise<SubmissionOutcome | null> {
  try {
    await ensureAttemptTables();
    const rows = await query<AttemptRow[]>(
      `SELECT status, started_at, expires_at, last_seen FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const attempt = rows[0];
    if (!attempt || attempt.status !== "active") return null;
    // Duration needed for legacy rows without expires_at.
    let durationMin = 30;
    try {
      const exams = await fetchExams();
      const f = exams.find((e) => e.id === examId);
      if (f && Number.isFinite(f.durationMinutes)) durationMin = f.durationMinutes;
    } catch {}
    // Backfill fixed expiry for legacy rows, then check.
    if (!attempt.expires_at) await backfillExpiresAt(examId, uid);
    const fresh = await query<AttemptRow[]>(
      `SELECT status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    const cur = fresh[0] ?? attempt;
    if (!cur || cur.status !== "active") return null;
    if (!isAttemptExpired(cur, durationMin)) return null;
    const outcome = await finalizeAttempt(examId, uid, studentName, {}, true);
    if (!outcome) return null;
    return { ...outcome, autoSubmitted: true };
  } catch {
    return null;
  }
}

export type HeartbeatResult =
  | { status: "ok"; secondsLeft?: number; expiresAt?: string | null; serverNow?: string | null }
  | { status: "abandoned"; outcome: SubmissionOutcome }
  | { status: "submitted" }
  | { status: "expired"; outcome: SubmissionOutcome };

/**
 * Presence ping (every ~20s). Records last_seen; finalizes ONLY on
 * expires_at. Never submits for silence/offline/hidden.
 */
export async function updateHeartbeat(
  examId: string,
  uid: string,
  studentName: string,
): Promise<HeartbeatResult> {
  try {
    await ensureAttemptTables();
    const expired = await finalizeAbandonedAttempt(examId, uid, studentName);
    if (expired) return { status: "expired", outcome: expired };
    const rows = await query<AttemptRow[]>(
      `SELECT status, started_at, expires_at FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
      [examId, uid],
    );
    if (!rows[0]) return { status: "ok" };
    if (rows[0].status !== "active") return { status: "submitted" };
    await exec(
      `UPDATE exam_attempts SET last_seen = CURRENT_TIMESTAMP WHERE exam_id = ? AND student_uid = ? AND status = 'active'`,
      [examId, uid],
    );
    let durationMin = 30;
    try {
      const exams = await fetchExams();
      const f = exams.find((e) => e.id === examId);
      if (f && Number.isFinite(f.durationMinutes)) durationMin = f.durationMinutes;
    } catch {}
    const serverNowIso = new Date().toISOString();
    const expMs = attemptTimeMs(rows[0].expires_at) ?? (() => {
      const s = attemptTimeMs(rows[0].started_at);
      return s !== null ? s + durationMin * 60 * 1000 : null;
    })();
    return {
      status: "ok",
      secondsLeft: remainingSecFor(rows[0], durationMin),
      expiresAt: expMs !== null ? new Date(expMs).toISOString() : null,
      serverNow: serverNowIso,
    };
  } catch {
    return { status: "ok" };
  }
}

export async function submitExamAttempt(
  examId: string,
  uid: string,
  studentName: string,
  answers: Record<string, number>,
): Promise<SubmissionOutcome | null> {
  const exams = await fetchExams();
  const found = exams.find((exam) => exam.id === examId);
  if (!found || !isLivePublished(found)) return null;
  // Enrolled exams can only be submitted by students enrolled in an assigned course.
  if (found.kind === "enrolled" && !(await hasEnrolledExamAccess(examId, uid))) {
    return null;
  }

  await ensureAttemptTables();

  // One-attempt for live-window exams: a prior completed result is returned
  // as-is. Practice retakes (post-live Practice phase AND enrolled-archived
  // practice phase) are exempt — each practice submit writes its own new
  // unranked practice row (see finalizeAttempt).
  let isPracticeRetakeSubmit = await isPostLivePracticeExam(found).catch(() => false);
  if (!isPracticeRetakeSubmit) {
    try {
      const { getEnrolledExamPhase, isEnrolledPracticePhase } = await import("@/lib/enrolled-exam-lifecycle");
      if (found.kind === "enrolled") {
        isPracticeRetakeSubmit = isEnrolledPracticePhase(getEnrolledExamPhase(found));
      }
    } catch {
      // Best-effort — keep default enforcement.
    }
  }
  if (!isPracticeRetakeSubmit) {
    try {
      const hasCompleted = await hasPriorExamAttempt(examId, uid);
      if (hasCompleted) {
        const existing = await latestOutcome(examId, uid);
        if (existing) return existing;
      }
    } catch {
      // best-effort
    }
  }

  // Already finalized (submitted / auto_submitted / expired / double-submit
  // race / concurrent expiry) → return the stored result, never re-grade.
  const attempts = await query<AttemptRow[]>(
    `SELECT session_token, status, started_at, expires_at, last_seen FROM exam_attempts WHERE exam_id = ? AND student_uid = ? LIMIT 1`,
    [examId, uid],
  );
  if (attempts[0] && attempts[0].status !== "active") {
    const existing = await latestOutcome(examId, uid);
    if (existing) {
      const wasAuto = attempts[0].status === "auto_submitted" || attempts[0].status === "expired";
      return wasAuto ? { ...existing, autoSubmitted: true } : existing;
    }
    return null;
  }

  // Backend decides expiry: now >= expires_at → auto-submit from stored +
  // in-flight answers, even if the student pressed Submit at 29:59.
  if (attempts[0]?.status === "active") {
    try {
      if (isAttemptExpired(attempts[0], found.durationMinutes)) {
        const outcome = await finalizeAttempt(examId, uid, studentName, answers, true);
        if (outcome) return { ...outcome, autoSubmitted: true };
        const latest = await latestOutcome(examId, uid);
        if (latest) return { ...latest, autoSubmitted: true };
      }
    } catch {
      // Ignore expiry check errors and proceed to normal finalize
    }
  }

  return finalizeAttempt(examId, uid, studentName, answers, false);
}

export type AnswerScriptQuestion = {
  questionId: number;
  question: string;
  options: string[];
  marks: number;
  /** Index the student selected — null when the question was left unanswered. */
  chosenIndex: number | null;
  /** NULL = unknown answer (rendered as "—", never as A). */
  correctIndex: number | null;
  /** Marks obtained for this question — negative on wrong answers. */
  obtained: number;
  explanation: string | null;
  /** Optional per-question image (question_image column / variant cell). */
  questionImage?: string | null;
};

export type ExamResultScript = {
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
  /** Student's locked language version (set/order stay server-side). */
  questionVersion?: QuestionVersion | null;
  questions: AnswerScriptQuestion[];
};

/**
 * The student's answer script — available ONLY after their attempt is
 * submitted. Joins the stored per-question breakdown with question text and
 * options so the client can show chosen vs correct answers side by side.
 */
export async function getExamResultScript(
  examId: string,
  uid: string,
): Promise<ExamResultScript | null> {
  const resultRows = await query<
    {
      student_name: string;
      score: string | number;
      total_marks: string | number;
      answers: string | null;
      details: string | null;
      submitted_at: Date | string;
      time_taken_seconds: number | null;
      merit_position: number | null;
      negative_deduction: string | number | null;
      timer_penalty: string | number | null;
      is_second_timer: number | null;
      question_version?: string | null;
      assigned_set?: string | null;
      question_order?: string | null;
    }[]
  >(
    `SELECT student_name, score, total_marks, answers, details, submitted_at,
            time_taken_seconds, merit_position, negative_deduction,
            timer_penalty, is_second_timer, question_version, assigned_set,
            question_order
     FROM exam_results
     WHERE exam_id = ? AND student_uid = ?
     ORDER BY id DESC LIMIT 1`,
    [examId, uid],
  ).catch(async () => {
    // Legacy DBs without the snapshot columns.
    const legacy = await query<
      {
        student_name: string;
        score: string | number;
        total_marks: string | number;
        answers: string | null;
        details: string | null;
        submitted_at: Date | string;
        time_taken_seconds: number | null;
        merit_position: number | null;
        negative_deduction: string | number | null;
        timer_penalty: string | number | null;
        is_second_timer: number | null;
      }[]
    >(
      `SELECT student_name, score, total_marks, answers, details, submitted_at,
              time_taken_seconds, merit_position, negative_deduction,
              timer_penalty, is_second_timer
       FROM exam_results
       WHERE exam_id = ? AND student_uid = ?
       ORDER BY id DESC LIMIT 1`,
      [examId, uid],
    );
    return legacy as {
      student_name: string;
      score: string | number;
      total_marks: string | number;
      answers: string | null;
      details: string | null;
      submitted_at: Date | string;
      time_taken_seconds: number | null;
      merit_position: number | null;
      negative_deduction: string | number | null;
      timer_penalty: string | number | null;
      is_second_timer: number | null;
      question_version?: string | null;
      assigned_set?: string | null;
      question_order?: string | null;
    }[];
  });
  const result = resultRows[0];
  if (!result) return null;

  const exams = await fetchExams();
  const found = exams.find((exam) => exam.id === examId);

  const detailRows = parseJsonColumn<ResultDetail[]>(result.details);
  const details: ResultDetail[] = Array.isArray(detailRows) ? detailRows : [];

  // Replay the student's own language version: variant content wins when the
  // result carries a version/set snapshot, otherwise base rows (legacy).
  const snapVersion = normalizeVersion(result.question_version);
  const snapSetRaw = String(result.assigned_set ?? "").toUpperCase();
  const snapSet: QuestionSet | null =
    snapSetRaw === "B" ? "B" : snapSetRaw === "A" ? "A" : null;
  let snapOrder: number[] | null = null;
  try {
    const rawOrder = result.question_order;
    if (typeof rawOrder === "string" && rawOrder) {
      const parsed: unknown = JSON.parse(rawOrder);
      if (Array.isArray(parsed)) {
        const ids = (parsed as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length > 0) snapOrder = ids;
      }
    } else if (Array.isArray(rawOrder)) {
      const ids = (rawOrder as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length > 0) snapOrder = ids;
    }
  } catch {
    snapOrder = null;
  }

  const questionRows = await query<{
    id: number;
    question: string;
    options: string;
    marks: string | number;
    correct_index: number | null;
    explanation: string | null;
    question_image?: string | null;
  }[]>(
    `SELECT id, question, options, marks, correct_index, explanation, question_image FROM exam_questions
      WHERE exam_id = ? AND is_active = 1 ORDER BY id ASC`,
    [examId],
  );
  // The student's language version/set replay: variant content wins when the
  // result carries a version/set snapshot. Base exam_questions rows may be
  // EMPTY placeholders (the admin paper editor stores content only in
  // exam_question_variants), so a result must NEVER render base placeholders
  // when a valid variant cell exists — otherwise the result page shows a
  // question number with blank text and empty/dark option blocks.
  let variantOverlay = new Map<string, VariantRow>();
  try {
    variantOverlay = await fetchVariantMap(examId);
  } catch {
    variantOverlay = new Map();
  }
  const byId = new Map<number, {
    question: string;
    options: string[];
    marks: number;
    /** NULL = unknown answer (rendered as "—", never as A). */
    correctIndex: number | null;
    explanation: string | null;
    questionImage: string | null;
  }>();
  /** Displayable content takes question text (or an image) plus ≥2 non-empty options. */
  const usableMeta = (
    question: string | null | undefined,
    options: string[],
    marks: number,
    correctIndex: number | null,
    explanation: string | null | undefined,
    questionImage: string | null | undefined,
  ) => {
    const text = String(question ?? "");
    if (text.trim().length === 0 && !questionImage) return null;
    if (options.length < 2 || options.some((o) => o.length === 0)) return null;
    return {
      question: text,
      options,
      marks,
      correctIndex,
      explanation: explanation ?? null,
      questionImage: questionImage ?? null,
    };
  };
  const baseMeta = (row: {
    question: string;
    options: string;
    marks: string | number;
    correct_index: number | null;
    explanation: string | null;
    question_image?: string | null;
  }) => {
    const parsed = parseJsonColumn<unknown[]>(row.options);
    if (!Array.isArray(parsed)) return null;
    return usableMeta(
      row.question,
      parsed.map(String),
      Number(row.marks) || 1,
      // Preserve an explicit unknown (NULL) — never coerce it to 0/A.
      // `|| 0` would wrongly turn a valid 0 (answer A) into 0 via falsy — use isFinite guard instead.
      row.correct_index === null || row.correct_index === undefined
        ? null
        : (Number.isFinite(Number(row.correct_index)) ? Number(row.correct_index) : null),
      row.explanation,
      (row.question_image as string | null) ?? null,
    );
  };
  const variantMeta = (variant: VariantRow | undefined, fallbackMarks: number) => {
    if (!variant) return null;
    const parsed = parseJsonColumn<unknown[]>(variant.options);
    if (!Array.isArray(parsed)) return null;
    return usableMeta(
      variant.question,
      parsed.map(String),
      Number(variant.marks) || fallbackMarks,
      // Preserve an explicit unknown (NULL) — never coerce it to 0/A.
      // `|| 0` would wrongly coerce non-finite into 0 — use isFinite guard.
      variant.correct_index === null || variant.correct_index === undefined
        ? null
        : (Number.isFinite(Number(variant.correct_index)) ? Number(variant.correct_index) : null),
      variant.explanation,
      variant.question_image ?? null,
    );
  };
  /** All authored variant cells for one question — attempt version/set first, then any. */
  const variantsFor = (questionId: number): VariantRow[] => {
    const ordered: VariantRow[] = [];
    const seen = new Set<string>();
    const langs = Array.from(
      new Set([snapVersion, "bangla", "english"].filter(Boolean) as string[]),
    );
    const sets = Array.from(
      new Set([snapSet, "A", "B"].filter(Boolean) as string[]),
    );
    for (const lang of langs) {
      for (const set of sets) {
        const key = `${questionId}:${lang}:${set}`;
        const row = variantOverlay.get(key);
        if (row && !seen.has(key)) {
          seen.add(key);
          ordered.push(row);
        }
      }
    }
    for (const [key, row] of variantOverlay) {
      if (key.startsWith(`${questionId}:`) && !seen.has(key)) {
        seen.add(key);
        ordered.push(row);
      }
    }
    return ordered;
  };
  for (const row of questionRows) {
    const qid = Number(row.id);
    const baseMarks = Number(row.marks) || 1;
    // 1) The exact locked variant for this attempt (grading is replayed from it too).
    let meta =
      snapVersion && snapSet
        ? variantMeta(variantOverlay.get(`${qid}:${snapVersion}:${snapSet}`), baseMarks)
        : null;
    // 2) Base-row content (legacy exams without authored variants).
    if (!meta) meta = baseMeta(row);
    // 3) Any valid variant cell — blank placeholder base rows must never reach the UI.
    if (!meta) {
      for (const candidate of variantsFor(qid)) {
        const m = variantMeta(candidate, baseMarks);
        if (m) {
          meta = m;
          break;
        }
      }
    }
    // 4) Last resort — keep whatever the base row has (never drop the question from the script).
    if (!meta) {
      const parsed = parseJsonColumn<unknown[]>(row.options);
      meta = {
        question: String(row.question ?? ""),
        options: Array.isArray(parsed) ? parsed.map(String) : [],
        marks: baseMarks,
        correctIndex: normalizeStoredAnswerIndex(row.correct_index),
        explanation: row.explanation ?? null,
        questionImage: (row.question_image as string | null) ?? null,
      };
    }
    byId.set(qid, meta);
  }

  // Prefer the stored per-question breakdown; fall back to the answers
  // snapshot + question keys when details are missing (older results).
  const fallbackAnswers =
    parseJsonColumn<Record<string, number>>(result.answers) ?? {};
  // Build a correctIndex lookup from stored details — grading-time values are
  // authoritative and must NOT be overwritten by base-row placeholders.
  const correctByDetailId = new Map<number, number | null>();
  for (const detail of details) {
    correctByDetailId.set(detail.questionId, detail.correctIndex);
  }
  const questions: AnswerScriptQuestion[] = [];
  const seen = new Set<number>();
  for (const detail of details) {
    const meta = byId.get(detail.questionId);
    if (!meta) continue;
    seen.add(detail.questionId);
    // Each question resolves its OWN stored answer (current question's ID —
    // never answers[0] or a shared global). Legacy rows may carry numeric
    // strings/letters, so values are normalized; unknown stays null.
    questions.push({
      questionId: detail.questionId,
      question: meta.question,
      options: meta.options,
      marks: meta.marks,
      chosenIndex: normalizeStoredAnswerIndex(detail.chosenIndex),
      correctIndex: normalizeStoredAnswerIndex(detail.correctIndex),
      obtained: Number(detail.obtained) || 0,
      explanation: meta.explanation,
      questionImage: meta.questionImage,
    });
  }
  for (const [key, meta] of byId.entries()) {
    if (seen.has(key)) continue;
    const raw = fallbackAnswers[String(key)];
    const chosen = normalizeStoredAnswerIndex(raw);
    // Prefer the correctIndex stored at grading time (detail); only fall back
    // to meta.correctIndex when no detail exists for this question (legacy path).
    const correctIndex = normalizeStoredAnswerIndex(
      correctByDetailId.has(key)
        ? (correctByDetailId.get(key) ?? null)
        : meta.correctIndex,
    );
    questions.push({
      questionId: key,
      question: meta.question,
      options: meta.options,
      marks: meta.marks,
      chosenIndex: chosen,
      correctIndex,
      obtained:
        chosen === null
          ? 0
          : chosen === correctIndex
            ? meta.marks
            : 0, // Legacy rows lack per-question deductions; totals stay authoritative.
      explanation: meta.explanation,
      questionImage: meta.questionImage,
    });
  }
  // Student's display order first (locked at start), then any extras by ID.
  if (snapOrder && snapOrder.length > 0) {
    const rank = new Map(snapOrder.map((id, index) => [Number(id), index]));
    questions.sort((a, b) => {
      const ra = rank.get(a.questionId);
      const rb = rank.get(b.questionId);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.questionId - b.questionId;
    });
  } else {
    questions.sort((a, b) => a.questionId - b.questionId);
  }

  const submittedMs = new Date(result.submitted_at).getTime();
  return {
    examName: found?.title ?? examId,
    score: Number(result.score) || 0,
    totalMarks: Number(result.total_marks) || 0,
    submittedAt: Number.isNaN(submittedMs)
      ? null
      : new Date(submittedMs).toISOString(),
    timeTakenSeconds:
      result.time_taken_seconds === null || result.time_taken_seconds === undefined
        ? null
        : Number(result.time_taken_seconds),
    meritPosition:
      result.merit_position === null || result.merit_position === undefined
        ? null
        : Number(result.merit_position),
    highestMark: await highestMarkFor(examId),
    negativeDeduction: toNum(result.negative_deduction),
    timerPenalty: toNum(result.timer_penalty),
    secondTimer: (result.is_second_timer ?? 0) === 1,
    questionVersion: snapVersion,
    questions,
  };
}
