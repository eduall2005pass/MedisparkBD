// Flow 5 — Exam Flow (ADDITIVE; Flows 1-4 untouched).
//
// Navigation (exact):
//   Course → 4 Exam Cards (Topic-wise / Paper Final / Subject Final / Final Model)
//   Topic-wise Exam → 8 Subject Cards → Topic-wise Exams (filtered by subject)
//   Paper Final Exam → Direct Exam List (NO subject page)
//   Subject Final Exam → Direct Exam List (NO subject page)
//   Final Model Test → Direct Exam List (NO subject page)
//
// Data rules:
// - exams.exam_format separates the 4 categories; legacy exams keep NULL and
//   never appear in Flow 5 lists (no mixing with the old Exam flow).
// - exams.topic_subject associates a topic-wise exam with one of the 8 fixed
//   subjects below.
// Access control lives in the API route (active enrollment + course link);
// exam taking reuses the existing engine (/exam/[id]/rules) unchanged.

import { ensureColumn, exec, query } from "@/lib/mysql";
import {
  isFlow5Format,
  isFlow5SubjectKey,
  type Flow5ExamItem,
  type Flow5Format,
  type Flow5SubjectKey,
} from "@/lib/flow5-shared";

// Re-export shared constants so server code can import from one place.
export {
  FLOW5_FORMATS,
  FLOW5_SUBJECTS,
  flow5SubjectTitle,
  isFlow5Format,
  isFlow5PracticePhase,
  isFlow5SubjectKey,
  normalizeFlow5Phase,
  type Flow5ExamItem,
  type Flow5ExamPhase,
  type Flow5Format,
  type Flow5SubjectKey,
} from "@/lib/flow5-shared";

let ensured = false;
export async function ensureFlow5Schema(): Promise<void> {
  if (ensured) return;
  try {
    await ensureColumn(
      "exams",
      "exam_format",
      "`exam_format` ENUM('topic-wise','paper-final','subject-final','final-model') NULL DEFAULT NULL AFTER course_type",
    );
  } catch {}
  try {
    await ensureColumn("exams", "topic_subject", "`topic_subject` VARCHAR(64) NULL DEFAULT NULL AFTER exam_format");
  } catch {}
  try {
    await exec(`CREATE INDEX idx_exams_flow5_format ON exams(exam_format, topic_subject, status)`);
  } catch {}
  ensured = true;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Flow5Row = {
  id: string;
  title: string;
  description: string | null;
  banner_url: string | null;
  exam_format: Flow5Format;
  topic_subject: string | null;
  subject: string | null;
  course_type: string | null;
  exam_mode: string | null;
  duration_minutes: number;
  total_marks: number;
  marks_per_question: string | number | null;
  negative_enabled: number | boolean | null;
  negative_per_wrong: string | number | null;
  second_timer_enabled: number | boolean | null;
  second_timer_deduction: string | number | null;
  scheduled_at: Date | string | null;
  ends_at: Date | string | null;
  question_count: number | null;
};

/** Upcoming → Live → Archived lifecycle — canonical course rule (see getCourseState). "practice" is a legacy alias of "archived". */
function phaseForRow(scheduledAt: string | null, endsAt: string | null): Flow5ExamItem["phase"] {
  const now = Date.now();
  const start = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const end = endsAt ? new Date(endsAt).getTime() : NaN;
  const hasStart = Number.isFinite(start);
  const hasEnd = Number.isFinite(end);
  if (!hasStart && !hasEnd) return "no-window";
  if (hasStart && now < start) return "upcoming";
  if (hasEnd && now > end) return "archived";
  return "live";
}

/**
 * Exams of ONE Flow-5 category belonging to a course.
 * Course link: exam_courses direct assignment OR chapter → subject → course.
 * Only published exams. Categories never mix (strict exam_format filter).
 * Topic-wise additionally filters by ONE subject (never mixed across subjects).
 */
export async function getFlow5Exams(
  courseSlug: string,
  format: Flow5Format,
  topicSubject?: Flow5SubjectKey | null,
): Promise<Flow5ExamItem[]> {
  await ensureFlow5Schema();
  // NOTE: placeholder order must match the SQL below (format, subject?, course, course).
  const params: unknown[] = [format];
  let subjectClause = "";
  if (format === "topic-wise") {
    if (topicSubject && isFlow5SubjectKey(topicSubject)) {
      subjectClause = "AND ex.topic_subject = ?";
      params.push(topicSubject);
    }
  }
  params.push(courseSlug, courseSlug, courseSlug);
  const rows = await query<Flow5Row[]>(
    `SELECT ex.id, ex.title, ex.description, ex.banner_url,
            ex.exam_format, ex.topic_subject, ex.subject, ex.course_type,
            ex.exam_mode, ex.duration_minutes, ex.total_marks,
            ex.marks_per_question, ex.negative_enabled, ex.negative_per_wrong,
            ex.second_timer_enabled, ex.second_timer_deduction,
            ex.scheduled_at, ex.ends_at, ex.question_count
       FROM exams ex
      WHERE ex.exam_format = ?
        AND ex.status = 'published'
        AND ex.kind = 'enrolled'
        ${subjectClause}
        AND (
          EXISTS (SELECT 1 FROM exam_courses ec WHERE ec.exam_id = ex.id AND ec.course_id = ?)
          OR EXISTS (
            SELECT 1 FROM course_chapters ch
              JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
             WHERE ch.id = ex.chapter_id AND a.course_slug = ?
               AND ch.is_active = 1
               AND (COALESCE(ch.course_slug, '') = '' OR ch.course_slug = a.course_slug)
          )
          OR EXISTS (
            SELECT 1 FROM course_chapters ch2
             WHERE ch2.id = ex.chapter_id AND ch2.course_slug = ? AND ch2.is_active = 1
          )
        )
      ORDER BY ex.sort_order ASC, ex.scheduled_at DESC, ex.created_at DESC`,
    params,
    { cache: false },
  );
  // Live totals from the same question rows the grader uses (never stale).
  const liveTotals = new Map<string, { total: number; cnt: number }>();
  try {
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const ph = ids.map(() => "?").join(",");
      const totals = await query<{ exam_id: string; total: string | number | null; cnt: number }[]>(
        `SELECT exam_id, SUM(marks) AS total, COUNT(*) AS cnt FROM exam_questions WHERE exam_id IN (${ph}) AND is_active = 1 GROUP BY exam_id`,
        ids,
        { cache: false },
      );
      for (const t of totals) {
        liveTotals.set(t.exam_id, {
          total: Math.round((Number(t.total ?? 0) || 0) * 100) / 100,
          cnt: Number(t.cnt ?? 0) || 0,
        });
      }
    }
  } catch {
    // Fall back to stored totals below.
  }
  return rows
    .filter((r) => isFlow5Format(r.exam_format))
    .map((r) => {
      const live = liveTotals.get(r.id);
      const scheduledAt = toIso(r.scheduled_at);
      const endsAt = toIso(r.ends_at);
      const negEnabled = r.negative_enabled === undefined || r.negative_enabled === null
        ? String(r.course_type ?? "") === "Admission"
        : Boolean(r.negative_enabled);
      const negPerWrong = r.negative_per_wrong === undefined || r.negative_per_wrong === null
        ? 0.25
        : Number(r.negative_per_wrong) || 0;
      return {
        id: r.id,
        title: r.title,
        format: r.exam_format,
        topicSubject: isFlow5SubjectKey(r.topic_subject) ? r.topic_subject : null,
        durationMinutes: Number(r.duration_minutes ?? 0) || 0,
        totalMarks: live ? live.total : Number(r.total_marks ?? 0) || 0,
        scheduledAt,
        scope: "COURSE" as const,
        subject: String(r.subject ?? ""),
        courseType: String(r.course_type ?? "") === "Admission" ? "Admission" as const : "Academic" as const,
        bannerUrl: r.banner_url ?? null,
        description: r.description ?? null,
        totalQuestions: live ? live.cnt : Number(r.question_count ?? 0) || 0,
        marksPerQuestion: Number(r.marks_per_question ?? 1) || 1,
        endsAt,
        examMode: r.exam_mode === "practice" ? "practice" as const : "live" as const,
        negativeEnabled: negEnabled,
        negativePerWrong: negEnabled ? negPerWrong : 0,
        secondTimerEnabled: Boolean(r.second_timer_enabled),
        secondTimerDeduction: Number(r.second_timer_deduction ?? 3) || 0,
        phase: phaseForRow(scheduledAt, endsAt),
      };
    });
}

/** Exam counts per Flow-5 category (+ per-subject for topic-wise) for card badges. */
export async function getFlow5Counts(courseSlug: string): Promise<{
  formats: Record<Flow5Format, number>;
  subjects: Record<Flow5SubjectKey, number>;
}> {
  await ensureFlow5Schema();
  const formats: Record<Flow5Format, number> = {
    "topic-wise": 0,
    "paper-final": 0,
    "subject-final": 0,
    "final-model": 0,
  };
  const subjects: Record<Flow5SubjectKey, number> = {
    "bio1-botany": 0,
    "bio2-zoology": 0,
    chem1: 0,
    chem2: 0,
    phy1: 0,
    phy2: 0,
    english: 0,
    gk: 0,
  };
  try {
    const rows = await query<{ exam_format: string; topic_subject: string | null; cnt: number | string }[]>(
      `SELECT ex.exam_format, ex.topic_subject, COUNT(*) AS cnt
         FROM exams ex
        WHERE ex.exam_format IS NOT NULL
          AND ex.status = 'published'
          AND ex.kind = 'enrolled'
          AND (
            EXISTS (SELECT 1 FROM exam_courses ec WHERE ec.exam_id = ex.id AND ec.course_id = ?)
            OR EXISTS (
              SELECT 1 FROM course_chapters ch
                JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
               WHERE ch.id = ex.chapter_id AND a.course_slug = ?
                 AND ch.is_active = 1
                 AND (COALESCE(ch.course_slug, '') = '' OR ch.course_slug = a.course_slug)
            )
            OR EXISTS (
              SELECT 1 FROM course_chapters ch2
               WHERE ch2.id = ex.chapter_id AND ch2.course_slug = ? AND ch2.is_active = 1
            )
          )
        GROUP BY ex.exam_format, ex.topic_subject`,
      [courseSlug, courseSlug, courseSlug],
      { cache: false },
    );
    for (const row of rows) {
      const n = Number(row.cnt ?? 0) || 0;
      if (isFlow5Format(row.exam_format)) formats[row.exam_format] += n;
      if (row.exam_format === "topic-wise" && isFlow5SubjectKey(row.topic_subject)) {
        subjects[row.topic_subject] += n;
      }
    }
  } catch {
    // Best effort — cards render with zero counts rather than failing.
  }
  return { formats, subjects };
}
