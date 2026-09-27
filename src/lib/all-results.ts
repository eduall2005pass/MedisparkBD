import { parseJsonColumn, query } from "@/lib/mysql";

// Public /result board — every scheduled (non-practice) result across ALL
// exams (public + course). Privacy-safe: name + student ID + college only.
// No email, no phone number, no UID is ever exposed.

export type ResultBoardRow = {
  resultId: number;
  examId: string;
  examTitle: string;
  examKind: string;
  rank: number | null;
  studentName: string;
  studentId: string | null;
  institution: string | null;
  obtained: number;
  totalMarks: number;
  percent: number;
  correctCount: number | null;
  wrongCount: number | null;
  skippedCount: number | null;
  accuracy: number | null;
  timeTakenSeconds: number | null;
  submittedAt: string;
  submissionType: "manual" | "auto";
  isSecondTimer: boolean;
};

export type ResultExamOption = {
  id: string;
  title: string;
  kind: string;
};

type DetailItem = {
  chosenIndex: number | null;
  correctIndex: number | null;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function deriveCounts(detailsRaw: string | null): {
  correct: number | null;
  wrong: number | null;
  skipped: number | null;
  accuracy: number | null;
} {
  const details = parseJsonColumn<DetailItem[]>(detailsRaw) ?? null;
  if (!Array.isArray(details) || details.length === 0) {
    return { correct: null, wrong: null, skipped: null, accuracy: null };
  }
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    if (d.chosenIndex === null || d.chosenIndex === undefined) skipped += 1;
    else if (
      d.correctIndex !== null &&
      d.correctIndex !== undefined &&
      d.chosenIndex === d.correctIndex
    )
      correct += 1;
    else wrong += 1;
  }
  const answered = correct + wrong;
  const total = answered + skipped;
  const accuracy =
    total > 0 ? Math.round((correct / total) * 1000) / 10 : null;
  return { correct, wrong, skipped, accuracy };
}

type BoardRow = {
  id: number;
  exam_id: string;
  exam_title: string;
  exam_kind: string;
  merit_position: number | null;
  student_name: string;
  student_id: string | null;
  institution: string | null;
  score: string | number;
  total_marks: string | number;
  details: string | null;
  time_taken_seconds: number | null;
  submitted_at: Date | string;
  auto_submitted?: number | null;
  is_second_timer?: number | null;
};

/** Exams that have at least one ranked result — filter dropdown. */
export async function fetchResultExams(): Promise<ResultExamOption[]> {
  try {
    // Ranked = anything except practice. Live DB stores 'live', newer code
    // writes 'scheduled' (see flow4 migration vs exam-taking.ts) — exclude
    // only 'practice' so both conventions work.
    const rows = await query<{ id: string; title: string; kind: string }[]>(
      `SELECT DISTINCT e.id, e.title, e.kind
         FROM exam_results r
         JOIN exams e ON e.id = r.exam_id
        WHERE (r.attempt_type IS NULL OR r.attempt_type <> 'practice')
        ORDER BY e.title ASC LIMIT 500`,
    );
    return rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind }));
  } catch {
    return [];
  }
}

export async function fetchAllResults(options: {
  examId?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<{ rows: ResultBoardRow[]; total: number }> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const offset = (page - 1) * limit;
  const examId = (options.examId ?? "").trim();
  const q = (options.q ?? "").trim();

  const where: string[] = [];
  const params: unknown[] = [];
  if (examId) {
    where.push("r.exam_id = ?");
    params.push(examId);
  }
  if (q) {
    where.push(
      "(r.student_name LIKE ? OR s.student_id LIKE ? OR s.institution LIKE ? OR e.title LIKE ?)",
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  // Best-effort column probe — old DBs may lack auto_submitted.
  let hasAutoSubmitted = true;
  try {
    const cols = await query<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'exam_results'
          AND column_name IN ('auto_submitted')`,
    );
    hasAutoSubmitted = cols.some((c) => c.column_name === "auto_submitted");
  } catch {
    // Probe failed — assume modern schema, fall back below on error.
  }

  const attemptFilter = "(r.attempt_type IS NULL OR r.attempt_type <> 'practice')";
  const autoCol = hasAutoSubmitted ? ", r.auto_submitted" : "";
  const buildFilter = (attempt: string) =>
    `WHERE ${[attempt, ...where].join(" AND ")}`;
  const selectCols = `r.id, r.exam_id, e.title AS exam_title, e.kind AS exam_kind,
    r.merit_position, r.student_name, s.student_id, s.institution,
    r.score, r.total_marks, r.details, r.time_taken_seconds,
    r.submitted_at${autoCol}, r.is_second_timer`;

  const runPaged = (filter: string) =>
    Promise.all([
      query<BoardRow[]>(
        `SELECT ${selectCols}
           FROM exam_results r
           JOIN exams e ON e.id = r.exam_id
           LEFT JOIN students s ON s.uid = r.student_uid
           ${filter}
           ORDER BY r.submitted_at DESC
           LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      query<{ n: number | string }[]>(
        `SELECT COUNT(*) AS n
           FROM exam_results r
           JOIN exams e ON e.id = r.exam_id
           LEFT JOIN students s ON s.uid = r.student_uid
           ${filter}`,
        params,
      ),
    ]);

  try {
    try {
      const [rows, countRows] = await runPaged(buildFilter(attemptFilter));
      return { rows: rows.map(mapRow), total: Number(countRows[0]?.n ?? 0) || 0 };
    } catch {
      // Legacy DB without attempt_type — fall back to all rows.
      const [rows, countRows] = await runPaged(buildFilter("1=1"));
      return { rows: rows.map(mapRow), total: Number(countRows[0]?.n ?? 0) || 0 };
    }
  } catch {
    return { rows: [], total: 0 };
  }
}

function mapRow(row: BoardRow): ResultBoardRow {
  const obtained = Math.round(toNumber(row.score) * 100) / 100;
  const totalMarks = toNumber(row.total_marks);
  const percent =
    totalMarks > 0 ? Math.round((obtained / totalMarks) * 1000) / 10 : 0;
  const counts = deriveCounts(row.details);
  return {
    resultId: row.id,
    examId: row.exam_id,
    examTitle: row.exam_title,
    examKind: row.exam_kind,
    rank: row.merit_position ?? null,
    studentName: row.student_name,
    studentId: row.student_id ?? null,
    institution: row.institution ?? null,
    obtained,
    totalMarks,
    percent,
    correctCount: counts.correct,
    wrongCount: counts.wrong,
    skippedCount: counts.skipped,
    accuracy: counts.accuracy,
    timeTakenSeconds: row.time_taken_seconds ?? null,
    submittedAt: toIso(row.submitted_at),
    submissionType:
      (row as { auto_submitted?: number | null }).auto_submitted === 1
        ? "auto"
        : "manual",
    isSecondTimer: (row.is_second_timer ?? 0) === 1,
  };
}
