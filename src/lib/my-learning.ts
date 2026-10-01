import { query } from "@/lib/mysql";
import {
  isDirectContent,
  type CourseContentLayout,
} from "@/lib/course-content";
import { fetchCatalogCourses } from "@/lib/courses-admin";

// ── Shared types (consumed by API routes + client components) ────────────

export type EnrolledCourseSummary = {
  slug: string;
  name: string;
  category: string;
  batchId: string;
  imageUrl: string;
  shortDescription: string;
  fee: number;
  discountFee: number | null;
  courseKind: "free" | "paid";
  enrollmentStatus: string;
  enrollmentDate: string;
  /** True when View Course Content opens the dedicated Class / Exam /
   *  Materials page (admin-set structure, or legacy name heuristic). */
  directContent: boolean;
  /** Admin-selected content structure for the course. */
  contentLayout: CourseContentLayout;
  progress: {
    totalClasses: number;
    completedClasses: number;
    percent: number;
  };
};

export type ClassItem = {
  id: string;
  title: string;
  videoUrl: string;
  noteUrl: string;
  durationMinutes: number;
  isFree: boolean;
  completed: boolean;
  lastSeenSeconds: number;
  isFavourite: boolean;
};

export type MaterialItem = {
  id: number;
  title: string;
  materialType: string;
  fileUrl: string;
  questionCount: number;
  isFavourite: boolean;
};

export type ChapterItem = {
  id: string;
  name: string;
  paperId: string | null;
  contentType: string;
  courseSlug: string | null;
  classes: ClassItem[];
  materials: MaterialItem[];
  exams: {
    id: string;
    title: string;
    durationMinutes: number;
    totalMarks: number;
    isFavourite: boolean;
    scheduledAt: string | null;
    endsAt: string | null;
  }[];
};

export type PaperItem = {
  id: string;
  name: string;
  kind: "paper" | "segment";
};

export type SubjectTree = {
  id: string;
  name: string;
  papers: PaperItem[];
  chapters: ChapterItem[];
};

export type CourseLearningData = {
  slug: string;
  name: string;
  category: string;
  batchId: string;
  imageUrl: string;
  shortDescription: string;
  description: string;
  teacherName: string;
  duration: string;
  fee: number;
  discountFee: number | null;
  courseKind: "free" | "paid";
  enrollmentStatus: string;
  enrollmentDate: string;
  progress: {
    totalClasses: number;
    completedClasses: number;
    percent: number;
  };
  /** Admin-selected content structure ("auto" = legacy name heuristic). */
  contentLayout: CourseContentLayout;
  subjects: SubjectTree[];
};

// ── Helpers ───────────────────────────────────────────────────────────────

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLayout(value: unknown): CourseContentLayout {
  const v = String(value ?? "").trim().toLowerCase();
  // New flow values (flow-5 = Course Flow 4 / Exam Flow; existing flows untouched).
  if (v === "flow-1" || v === "flow-2" || v === "flow-3" || v === "flow-5") return v as CourseContentLayout;
  // Legacy flow-4 (unused) → migrate to flow-5 (Course Flow 4).
  if (v === "flow-4") return "flow-5";
  // Backward compatibility: map old values.
  if (v === "direct") return "flow-1";
  if (v === "paper") return "flow-2";
  if (v === "subject") return "flow-3";
  return "flow-1";
}

async function loadProgress(
  uid: string,
): Promise<Map<string, { completed: boolean; lastSeenSeconds: number }>> {
  const rows = await query<
    { class_id: string; completed: number; last_seen_seconds: number }[]
  >(
    "SELECT class_id, completed, last_seen_seconds FROM student_class_progress WHERE student_uid = ?",
    [uid],
  );
  return new Map(
    rows.map((row) => [
      row.class_id,
      {
        completed: row.completed === 1,
        lastSeenSeconds: toNumber(row.last_seen_seconds),
      },
    ]),
  );
}

async function loadFavourites(uid: string): Promise<Set<string>> {
  const rows = await query<{ item_type: string; item_id: string }[]>(
    "SELECT item_type, item_id FROM student_favourites WHERE student_uid = ?",
    [uid],
  );
  return new Set(rows.map((row) => `${row.item_type}:${row.item_id}`));
}

export async function hasActiveEnrollment(
  uid: string,
  courseId: string,
): Promise<boolean> {
  const rows = await query<{ found: number }[]>(
    "SELECT 1 AS found FROM enrollments WHERE student_uid = ? AND course_id = ? AND enrollment_status = 'active' LIMIT 1",
    [uid, courseId],
  );
  return rows.length > 0;
}

/** Kept as a thin alias — the logic now lives in @/lib/course-content so
 *  client components can use it too (this module is server-only). */
export function usesDirectCourseContent(
  name?: string | null,
  slug?: string | null,
): boolean {
  return isDirectContent("flow-1", name, slug);
}

// ── Enrolled course list ──────────────────────────────────────────────────

type EnrolledCourseRow = {
  slug: string;
  name: string;
  category: string | null;
  batch_id: string | null;
  image_url: string | null;
  short_description: string | null;
  fee: number;
  discount_fee: number | null;
  course_kind: "free" | "paid";
  enrollment_status: string;
  enrollment_date: Date | string;
  content_layout: string | null;
};

export async function getMyEnrolledCourses(
  uid: string,
): Promise<EnrolledCourseSummary[]> {
  // Active enrollment covers all three paths: enrolled (free), purchased
  // (paid + approved) and assigned by an admin. Pending/cancelled rows are
  // never shown as courses.
  // Include BOTH active and pending enrollments: active courses are fully
  // accessible; pending ones render with a disabled state. The content API
  // (/api/my/courses/[slug]) independently rejects non-active enrollment.
  const rows = await query<EnrolledCourseRow[]>(
    `SELECT e.course_id AS slug,
            COALESCE(NULLIF(c.name, ''), e.course_name) AS name,
            COALESCE(c.category, e.course_type) AS category,
            c.batch_id, c.image_url, c.short_description, c.fee, c.discount_fee,
            c.content_layout, e.course_kind, e.enrollment_status, e.enrollment_date
       FROM enrollments e
       LEFT JOIN catalog_courses c ON c.slug = e.course_id
      WHERE e.student_uid = ?
        AND e.enrollment_status IN ('active', 'pending')
      -- Active courses always come first; existing order kept within each
      -- status group (most recently updated first).
      ORDER BY CASE WHEN e.enrollment_status = 'active' THEN 0 ELSE 1 END,
               e.updated_at DESC`,
    [uid],
  );

  // No enrollment records → an EMPTY list, never an error. (Previously the
  // progress query below ran even with zero enrollments, so a missing
  // learning table turned "no courses" into a 500 for every student.)
  if (rows.length === 0) return [];

  // Progress is supplementary — if the learning tables are missing or the
  // aggregate fails, courses must still render (with 0% progress) instead of
  // the whole request failing.
  //
  // Applicable content = active classes (course_classes) reachable through
  // the EXISTING content structure, both paths:
  //   1. subject path: enrollment course → course_subject_assignments →
  //      course_chapters (course_slug-isolated) → course_classes
  //   2. direct path: course_chapters scoped by course_slug with no subject
  //      → course_classes (e.g. SSC Biology direct courses).
  // Completed content = rows in the existing student_class_progress table
  // with completed = 1 for THIS student (persisted per authenticated
  // account, so refresh / logout / other devices all read the same data).
  try {
    const slugs = rows.map((row) => row.slug);
    const placeholders = slugs.map(() => "?").join(",");
    const [subjectProgress, directProgress] = await Promise.all([
      query<{ course_slug: string; total: number; done: number }[]>(
        `SELECT a.course_slug,
                COUNT(cl.id) AS total,
                SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS done
           FROM course_subject_assignments a
           JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
                AND (COALESCE(ch.course_slug, '') = '' OR ch.course_slug = a.course_slug)
           JOIN course_classes cl ON cl.chapter_id = ch.id AND cl.is_active = 1
           LEFT JOIN student_class_progress p
                  ON p.class_id = cl.id AND p.student_uid = ?
          WHERE a.course_slug IN (${placeholders})
          GROUP BY a.course_slug`,
        [uid, ...slugs],
      ),
      query<{ course_slug: string; total: number; done: number }[]>(
        `SELECT ch.course_slug,
                COUNT(cl.id) AS total,
                SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS done
           FROM course_chapters ch
           JOIN course_classes cl ON cl.chapter_id = ch.id AND cl.is_active = 1
           LEFT JOIN student_class_progress p
                  ON p.class_id = cl.id AND p.student_uid = ?
          WHERE ch.is_active = 1
            AND ch.course_slug IN (${placeholders})
            AND COALESCE(ch.subject_id, '') = ''
          GROUP BY ch.course_slug`,
        [uid, ...slugs],
      ),
    ]);
    const progressMap = new Map<string, { total: number; done: number }>();
    for (const row of [...subjectProgress, ...directProgress]) {
      const entry = progressMap.get(row.course_slug) ?? { total: 0, done: 0 };
      entry.total += toNumber(row.total);
      entry.done += toNumber(row.done);
      progressMap.set(row.course_slug, entry);
    }

    return rows.map((row) => {
      const progress = progressMap.get(row.slug);
      const totalClasses = toNumber(progress?.total ?? 0);
      const completedClasses = toNumber(progress?.done ?? 0);
      const contentLayout = toLayout(row.content_layout);
      return {
        slug: row.slug,
        name: toStringOrNull(row.name) ?? row.slug,
        category: row.category ?? "",
        batchId: row.batch_id ?? "",
        imageUrl: toStringOrNull(row.image_url) ?? "",
        shortDescription: toStringOrNull(row.short_description) ?? "",
        fee: toNumber(row.fee),
        discountFee:
          row.discount_fee !== null && row.discount_fee !== undefined
            ? toNumber(row.discount_fee)
            : null,
        courseKind: row.course_kind,
        enrollmentStatus: row.enrollment_status,
        enrollmentDate:
          row.enrollment_date instanceof Date
            ? row.enrollment_date.toISOString()
            : String(row.enrollment_date ?? ""),
        contentLayout,
        directContent: isDirectContent(contentLayout, toStringOrNull(row.name), row.slug),
        progress: {
          totalClasses,
          completedClasses,
          percent:
            totalClasses > 0
              ? Math.round((completedClasses / totalClasses) * 100)
              : 0,
        },
      };
    });
  } catch (error) {
    // Log the real cause for debugging, then degrade gracefully — courses
    // must still render even when the learning tables are not migrated yet.
    console.error(
      "[my-learning] progress aggregate failed; serving courses without progress:",
      error,
    );
    return rows.map((row) => {
      const contentLayout = toLayout(row.content_layout);
      return {
        slug: row.slug,
        name: toStringOrNull(row.name) ?? row.slug,
        category: row.category ?? "",
        batchId: row.batch_id ?? "",
        imageUrl: toStringOrNull(row.image_url) ?? "",
        shortDescription: toStringOrNull(row.short_description) ?? "",
        fee: toNumber(row.fee),
        discountFee:
          row.discount_fee !== null && row.discount_fee !== undefined
            ? toNumber(row.discount_fee)
            : null,
        courseKind: row.course_kind,
        enrollmentStatus: row.enrollment_status,
        enrollmentDate:
          row.enrollment_date instanceof Date
            ? row.enrollment_date.toISOString()
            : String(row.enrollment_date ?? ""),
        contentLayout,
        directContent: isDirectContent(contentLayout, toStringOrNull(row.name), row.slug),
        progress: { totalClasses: 0, completedClasses: 0, percent: 0 },
      };
    });
  }
}

// ── Full course learning tree ─────────────────────────────────────────────

type CatalogRow = {
  slug: string;
  name: string;
  category: string;
  batch_id: string;
  image_url: string | null;
  short_description: string | null;
  description: string | null;
  teacher_name: string | null;
  duration: string | null;
  fee: number;
  discount_fee: number | null;
  content_layout?: string | null;
};

type EnrollmentMetaRow = {
  course_kind: "free" | "paid";
  course_name: string | null;
  course_type: string | null;
  enrollment_status: string;
  enrollment_date: Date | string;
};

type SubjectRow = { id: string; name: string };
type PaperRow = {
  id: string;
  subject_id: string;
  name: string;
  kind: "paper" | "segment";
};
type ChapterRow = {
  id: string;
  subject_id: string;
  paper_id: string | null;
  name: string;
  content_type?: string | null;
  course_slug?: string | null;
};
type ClassRow = {
  id: string;
  chapter_id: string;
  title: string;
  video_url: string | null;
  note_url: string | null;
  duration_minutes: number;
  is_free: number;
};
type MaterialRow = {
  id: number;
  chapter_id: string;
  title: string;
  material_type: string;
  file_url: string;
  question_count?: number | null;
};
type ExamRow = {
  id: string;
  chapter_id: string | null;
  title: string;
  duration_minutes: number;
  total_marks: number;
  scheduled_at?: string | Date | null;
  ends_at?: string | Date | null;
};

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}


/**
 * Run a supplementary query without letting its failure break the whole
 * course payload. A missing/unmigrated table must never block an actively
 * enrolled student from opening their course.
 */
async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[my-learning] ${label} failed:`, error);
    return fallback;
  }
}

export async function getCourseLearningData(
  uid: string,
  slug: string,
): Promise<CourseLearningData | null> {
  const enrollmentRows = await query<EnrollmentMetaRow[]>(
    "SELECT course_kind, course_name, course_type, enrollment_status, enrollment_date FROM enrollments WHERE student_uid = ? AND course_id = ? LIMIT 1",
    [uid, slug],
  );
  const enrollment = enrollmentRows[0];
  if (!enrollment || enrollment.enrollment_status !== "active") {
    return null;
  }

  const catalogRows = await query<CatalogRow[]>(
    "SELECT slug, name, category, batch_id, image_url, short_description, description, teacher_name, duration, fee, discount_fee, content_layout FROM catalog_courses WHERE slug = ? LIMIT 1",
    [slug],
  );
  // Fall back to the enrollment's own stored course info when the catalog
  // row is missing — an active enrollment must always open its course page.
  const catalog: CatalogRow = catalogRows[0] ?? {
    slug,
    name: toStringOrNull(enrollment.course_name) ?? slug,
    category: enrollment.course_type ?? "Academic",
    batch_id: "",
    image_url: null,
    short_description: null,
    description: null,
    teacher_name: null,
    duration: null,
    fee: 0,
    discount_fee: null,
    content_layout: null,
  };

  const [subjectsRaw, progress, favourites] = await Promise.all([
    safe<SubjectRow[]>(
      "subjects query",
      () =>
        query<SubjectRow[]>(
          `SELECT s.id, s.name
             FROM course_subjects s
             JOIN course_subject_assignments a ON a.subject_id = s.id
            WHERE a.course_slug = ? AND s.is_active = 1
            ORDER BY s.sort_order, s.name`,
          [slug],
        ),
      [],
    ),
    safe("progress query", () => loadProgress(uid), new Map()),
    safe("favourites query", () => loadFavourites(uid), new Set<string>()),
  ]);
  let subjects = subjectsRaw;

  // --- Unified chapter fetch with course_slug isolation (single source of truth) ---
  let papers: PaperRow[] = [];
  let chapters: ChapterRow[] = [];

  if (subjects.length === 0) {
    // Direct course (e.g. SSC Biology): load course_slug-scoped chapters that
    // have no subject (content-control direct mode). Create synthetic subject so
    // existing DirectContentView can render them via flatChapters.
    const directChapters = await safe<ChapterRow[]>(
      "direct chapters query",
      () =>
        query<ChapterRow[]>(
          `SELECT id, subject_id, paper_id, name, content_type, course_slug FROM course_chapters
            WHERE is_active = 1 AND COALESCE(course_slug,'') = ? AND COALESCE(subject_id,'') = ''
            ORDER BY sort_order, name`,
          [slug],
        ),
      [],
    );
    if (directChapters.length === 0) {
      return buildCourseData(catalog, enrollment, [], progress, favourites);
    }
    subjects = [{ id: "__direct__", name: catalog.name }];
    chapters = directChapters.map((ch) => ({ ...ch, subject_id: "__direct__" }));
  } else {
    const subjectIds = subjects.map((subject) => subject.id);
    const subjectPlaceholders = subjectIds.map(() => "?").join(",");

    const [fetchedPapers, fetchedChapters] = await Promise.all([
      safe<PaperRow[]>(
        "papers query",
        () =>
          query<PaperRow[]>(
            `SELECT id, subject_id, name, kind FROM course_papers
              WHERE subject_id IN (${subjectPlaceholders}) AND is_active = 1
              ORDER BY sort_order, name`,
            subjectIds,
          ),
        [],
      ),
      safe<ChapterRow[]>(
        "chapters query",
        () =>
          query<ChapterRow[]>(
            `SELECT id, subject_id, paper_id, name, content_type, course_slug FROM course_chapters
              WHERE is_active = 1 AND (
                COALESCE(course_slug,'') = ?
                OR (COALESCE(course_slug,'') = '' AND subject_id IN (${subjectPlaceholders}))
              )
              ORDER BY sort_order, name`,
            [slug, ...subjectIds],
          ),
        [],
      ),
    ]);
    papers = fetchedPapers;
    chapters = fetchedChapters;
  }

  const chapterIds = chapters.map((chapter) => chapter.id);

  let classes: ClassRow[] = [];
  let materials: MaterialRow[] = [];
  let exams: ExamRow[] = [];

  if (chapterIds.length > 0) {
    const chapterPlaceholders = chapterIds.map(() => "?").join(",");
    [classes, materials, exams] = await Promise.all([
      safe<ClassRow[]>(
        "classes query",
        () =>
          query<ClassRow[]>(
            `SELECT id, chapter_id, title, video_url, note_url, duration_minutes, is_free
               FROM course_classes
              WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
              ORDER BY sort_order, created_at`,
            chapterIds,
          ),
        [],
      ),
      safe<MaterialRow[]>(
        "materials query",
        async () => {
          try {
            return await query<MaterialRow[]>(
              `SELECT id, chapter_id, title, material_type, file_url, question_count
                 FROM course_materials
                WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
                ORDER BY sort_order, id`,
              chapterIds,
            );
          } catch {
            return await query<MaterialRow[]>(
              `SELECT id, chapter_id, title, material_type, file_url
                 FROM course_materials
                WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
                ORDER BY sort_order, id`,
              chapterIds,
            );
          }
        },
        [],
      ),
      safe<ExamRow[]>(
        "exams query",
        async () => {
          try {
            return await query<ExamRow[]>(
              `SELECT id, chapter_id, title, duration_minutes, total_marks, scheduled_at, ends_at
                 FROM exams
                WHERE chapter_id IN (${chapterPlaceholders}) AND status = 'published'
                ORDER BY sort_order ASC, scheduled_at DESC`,
              chapterIds,
            );
          } catch {
            // scheduled_at/ends_at columns may not exist on older DBs.
            return await query<ExamRow[]>(
              `SELECT id, chapter_id, title, duration_minutes, total_marks
                 FROM exams
                WHERE chapter_id IN (${chapterPlaceholders}) AND status = 'published'
                ORDER BY sort_order ASC`,
              chapterIds,
            );
          }
        },
        [],
      ),
    ]);
  }

  return buildCourseData(catalog, enrollment, subjects, progress, favourites, {
    papers,
    chapters,
    classes,
    materials,
    exams,
  });
}

function buildCourseData(
  catalog: CatalogRow,
  enrollment: EnrollmentMetaRow,
  subjects: SubjectRow[],
  progress: Map<string, { completed: boolean; lastSeenSeconds: number }>,
  favourites: Set<string>,
  content?: {
    papers: PaperRow[];
    chapters: ChapterRow[];
    classes: ClassRow[];
    materials: MaterialRow[];
    exams: ExamRow[];
  },
): CourseLearningData {
  const tree: SubjectTree[] = subjects.map((subject) => ({
    id: subject.id,
    name: subject.name,
    papers: [],
    chapters: [],
  }));
  const subjectById = new Map(tree.map((subject) => [subject.id, subject]));

  for (const paper of content?.papers ?? []) {
    subjectById.get(paper.subject_id)?.papers.push({
      id: paper.id,
      name: paper.name,
      kind: paper.kind,
    });
  }

  const chaptersBySubject = new Map<string, ChapterItem[]>();
  for (const chapter of content?.chapters ?? []) {
    const item: ChapterItem = {
      id: chapter.id,
      name: chapter.name,
      paperId: chapter.paper_id,
      contentType: (chapter.content_type ?? "class") as string,
      courseSlug: (chapter.course_slug ?? null) as string | null,
      classes: [],
      materials: [],
      exams: [],
    };
    const list = chaptersBySubject.get(chapter.subject_id) ?? [];
    list.push(item);
    chaptersBySubject.set(chapter.subject_id, list);
  }
  for (const [subjectId, list] of chaptersBySubject) {
    const subject = subjectById.get(subjectId);
    if (subject) subject.chapters = list;
  }

  const chapterById = new Map<string, ChapterItem>();
  for (const list of chaptersBySubject.values()) {
    for (const chapter of list) chapterById.set(chapter.id, chapter);
  }

  for (const cls of content?.classes ?? []) {
    const chapter = chapterById.get(cls.chapter_id);
    if (!chapter) continue;
    const progressEntry = progress.get(cls.id);
    chapter.classes.push({
      id: cls.id,
      title: cls.title,
      videoUrl: toStringOrNull(cls.video_url) ?? "",
      noteUrl: toStringOrNull(cls.note_url) ?? "",
      durationMinutes: toNumber(cls.duration_minutes),
      isFree: cls.is_free === 1,
      completed: progressEntry?.completed ?? false,
      lastSeenSeconds: progressEntry?.lastSeenSeconds ?? 0,
      isFavourite: favourites.has(`class:${cls.id}`),
    });
  }

  for (const material of content?.materials ?? []) {
    const chapter = chapterById.get(material.chapter_id);
    if (!chapter) continue;
    chapter.materials.push({
      id: material.id,
      title: material.title,
      materialType: material.material_type,
      fileUrl: material.file_url,
      questionCount: Math.max(0, Number(material.question_count ?? 0) || 0),
      isFavourite: favourites.has(`material:${material.id}`),
    });
  }

  for (const exam of content?.exams ?? []) {
    const chapter = exam.chapter_id
      ? chapterById.get(exam.chapter_id)
      : undefined;
    if (!chapter) continue;
    chapter.exams.push({
      id: exam.id,
      title: exam.title,
      durationMinutes: toNumber(exam.duration_minutes),
      totalMarks: toNumber(exam.total_marks),
      isFavourite: favourites.has(`exam:${exam.id}`),
      scheduledAt: toIsoOrNull(exam.scheduled_at),
      endsAt: toIsoOrNull(exam.ends_at),
    });
  }

  const totalClasses = [...chapterById.values()].reduce(
    (sum, chapter) => sum + chapter.classes.length,
    0,
  );
  const completedClasses = [...chapterById.values()].reduce(
    (sum, chapter) =>
      sum + chapter.classes.filter((cls) => cls.completed).length,
    0,
  );

  return {
    slug: catalog.slug,
    name: catalog.name,
    category: catalog.category,
    batchId: catalog.batch_id,
    imageUrl: toStringOrNull(catalog.image_url) ?? "",
    shortDescription: toStringOrNull(catalog.short_description) ?? "",
    description: toStringOrNull(catalog.description) ?? "",
    teacherName: toStringOrNull(catalog.teacher_name) ?? "",
    duration: toStringOrNull(catalog.duration) ?? "",
    fee: toNumber(catalog.fee),
    discountFee:
      catalog.discount_fee !== null && catalog.discount_fee !== undefined
        ? toNumber(catalog.discount_fee)
        : null,
    courseKind: enrollment.course_kind,
    enrollmentStatus: enrollment.enrollment_status,
    enrollmentDate:
      enrollment.enrollment_date instanceof Date
        ? enrollment.enrollment_date.toISOString()
        : String(enrollment.enrollment_date ?? ""),
    progress: {
      totalClasses,
      completedClasses,
      percent:
        totalClasses > 0
          ? Math.round((completedClasses / totalClasses) * 100)
          : 0,
    },
    contentLayout: toLayout(catalog.content_layout),
    subjects: tree,
  };
}

// ── Admin panel: full course content tree (no enrollment required) ───────
//
// Same hierarchy, same tables and same shape as the student flow — only the
// access rule differs: admins browse EVERY course regardless of enrollment.
// Student permissions stay enrollment-based on all /api/my/* routes.

export type AdminCourseSummary = {
  slug: string;
  name: string;
  category: string;
  batchId: string;
  imageUrl: string;
  shortDescription: string;
  fee: number;
  discountFee: number | null;
  courseKind: "free" | "paid";
  counts: {
    subjects: number;
    chapters: number;
    classes: number;
    exams: number;
    materials: number;
  };
};

export async function getAdminCourseSummaries(): Promise<AdminCourseSummary[]> {
  const catalog = await fetchCatalogCourses();
  if (catalog.length === 0) return [];

  const [subjectCounts, chapterCounts, classCounts, examCounts, materialCounts] =
    await Promise.all([
      safe(
        "admin subject counts",
        () =>
          query<{ course_slug: string; cnt: string | number }[]>(
            `SELECT a.course_slug, COUNT(DISTINCT s.id) AS cnt
               FROM course_subject_assignments a
               JOIN course_subjects s ON s.id = a.subject_id AND s.is_active = 1
              GROUP BY a.course_slug`,
          ),
        [] as { course_slug: string; cnt: string | number }[],
      ),
      safe(
        "admin chapter counts",
        () =>
          query<{ course_slug: string; cnt: string | number }[]>(
            `SELECT a.course_slug, COUNT(ch.id) AS cnt
               FROM course_subject_assignments a
               JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
              GROUP BY a.course_slug`,
          ),
        [] as { course_slug: string; cnt: string | number }[],
      ),
      safe(
        "admin class counts",
        () =>
          query<{ course_slug: string; cnt: string | number }[]>(
            `SELECT a.course_slug, COUNT(cl.id) AS cnt
               FROM course_subject_assignments a
               JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
               JOIN course_classes cl ON cl.chapter_id = ch.id AND cl.is_active = 1
              GROUP BY a.course_slug`,
          ),
        [] as { course_slug: string; cnt: string | number }[],
      ),
      safe(
        "admin exam counts",
        () =>
          query<{ course_slug: string; cnt: string | number }[]>(
            `SELECT a.course_slug, COUNT(ex.id) AS cnt
               FROM course_subject_assignments a
               JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
               JOIN exams ex ON ex.chapter_id = ch.id AND ex.status = 'published'
              GROUP BY a.course_slug`,
          ),
        [] as { course_slug: string; cnt: string | number }[],
      ),
      safe(
        "admin material counts",
        () =>
          query<{ course_slug: string; cnt: string | number }[]>(
            `SELECT a.course_slug, COUNT(m.id) AS cnt
               FROM course_subject_assignments a
               JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
               JOIN course_materials m ON m.chapter_id = ch.id AND m.is_active = 1
              GROUP BY a.course_slug`,
          ),
        [] as { course_slug: string; cnt: string | number }[],
      ),
    ]);

  const toCountMap = (
    rows: { course_slug: string; cnt: string | number }[],
  ): Map<string, number> =>
    new Map(rows.map((row) => [row.course_slug, Number(row.cnt) || 0]));

  const subjectsMap = toCountMap(subjectCounts);
  const chaptersMap = toCountMap(chapterCounts);
  const classesMap = toCountMap(classCounts);
  const examsMap = toCountMap(examCounts);
  const materialsMap = toCountMap(materialCounts);

  return catalog.map((course) => {
    const payableFee =
      course.discountFee !== null && course.discountFee !== undefined
        ? course.discountFee
        : course.fee;
    return {
      slug: course.slug,
      name: course.name,
      category: course.category,
      batchId: course.batchId ?? "",
      imageUrl: course.image ?? "",
      shortDescription: course.shortDescription ?? "",
      fee: course.fee,
      discountFee: course.discountFee,
      courseKind: payableFee > 0 ? "paid" : "free",
      counts: {
        subjects: subjectsMap.get(course.slug) ?? 0,
        chapters: chaptersMap.get(course.slug) ?? 0,
        classes: classesMap.get(course.slug) ?? 0,
        exams: examsMap.get(course.slug) ?? 0,
        materials: materialsMap.get(course.slug) ?? 0,
      },
    };
  });
}

/** Admin variant of getCourseLearningData — no enrollment check, no personal progress. */
export async function getAdminCourseLearningData(
  slug: string,
): Promise<CourseLearningData | null> {
  const catalogRows = await query<CatalogRow[]>(
    "SELECT slug, name, category, batch_id, image_url, short_description, description, teacher_name, duration, fee, discount_fee, content_layout FROM catalog_courses WHERE slug = ? LIMIT 1",
    [slug],
  );
  const catalog = catalogRows[0];
  if (!catalog) return null;

  const payableFee =
    catalog.discount_fee !== null && catalog.discount_fee !== undefined
      ? catalog.discount_fee
      : catalog.fee;
  const syntheticEnrollment: EnrollmentMetaRow = {
    course_kind: payableFee > 0 ? "paid" : "free",
    course_name: catalog.name,
    course_type: catalog.category,
    enrollment_status: "active",
    enrollment_date: "",
  };

  let subjects = await safe<SubjectRow[]>(
    "subjects query",
    () =>
      query<SubjectRow[]>(
        `SELECT s.id, s.name
           FROM course_subjects s
           JOIN course_subject_assignments a ON a.subject_id = s.id
          WHERE a.course_slug = ? AND s.is_active = 1
          ORDER BY s.sort_order, s.name`,
        [slug],
      ),
    [],
  );

  let papers: PaperRow[] = [];
  let chapters: ChapterRow[] = [];
  if (subjects.length === 0) {
    const directChapters = await safe<ChapterRow[]>(
      "direct chapters query",
      () =>
        query<ChapterRow[]>(
          `SELECT id, subject_id, paper_id, name, content_type, course_slug FROM course_chapters
            WHERE is_active = 1 AND COALESCE(course_slug,'') = ? AND COALESCE(subject_id,'') = ''
            ORDER BY sort_order, name`,
          [slug],
        ),
      [],
    );
    if (directChapters.length === 0) {
      return buildCourseData(catalog, syntheticEnrollment, [], new Map(), new Set());
    }
    subjects = [{ id: "__direct__", name: catalog.name }];
    chapters = directChapters.map((ch) => ({ ...ch, subject_id: "__direct__" }));
  } else {
    const subjectIds = subjects.map((subject) => subject.id);
    const subjectPlaceholders = subjectIds.map(() => "?").join(",");
    const [fetchedPapers, fetchedChapters] = await Promise.all([
      safe<PaperRow[]>(
        "papers query",
        () =>
          query<PaperRow[]>(
            `SELECT id, subject_id, name, kind FROM course_papers
              WHERE subject_id IN (${subjectPlaceholders}) AND is_active = 1
              ORDER BY sort_order, name`,
            subjectIds,
          ),
        [],
      ),
      safe<ChapterRow[]>(
        "chapters query",
        () =>
          query<ChapterRow[]>(
            `SELECT id, subject_id, paper_id, name, content_type, course_slug FROM course_chapters
              WHERE is_active = 1 AND (
                COALESCE(course_slug,'') = ?
                OR (COALESCE(course_slug,'') = '' AND subject_id IN (${subjectPlaceholders}))
              )
              ORDER BY sort_order, name`,
            [slug, ...subjectIds],
          ),
        [],
      ),
    ]);
    papers = fetchedPapers;
    chapters = fetchedChapters;
  }

  const chapterIds = chapters.map((chapter) => chapter.id);

  let classes: ClassRow[] = [];
  let materials: MaterialRow[] = [];
  let exams: ExamRow[] = [];

  if (chapterIds.length > 0) {
    const chapterPlaceholders = chapterIds.map(() => "?").join(",");
    [classes, materials, exams] = await Promise.all([
      safe<ClassRow[]>(
        "classes query",
        () =>
          query<ClassRow[]>(
            `SELECT id, chapter_id, title, video_url, note_url, duration_minutes, is_free
               FROM course_classes
              WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
              ORDER BY sort_order, created_at`,
            chapterIds,
          ),
        [],
      ),
      safe<MaterialRow[]>(
        "materials query",
        async () => {
          try {
            return await query<MaterialRow[]>(
              `SELECT id, chapter_id, title, material_type, file_url, question_count
                 FROM course_materials
                WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
                ORDER BY sort_order, id`,
              chapterIds,
            );
          } catch {
            return await query<MaterialRow[]>(
              `SELECT id, chapter_id, title, material_type, file_url
                 FROM course_materials
                WHERE chapter_id IN (${chapterPlaceholders}) AND is_active = 1
                ORDER BY sort_order, id`,
              chapterIds,
            );
          }
        },
        [],
      ),
      safe<ExamRow[]>(
        "exams query",
        async () => {
          try {
            return await query<ExamRow[]>(
              `SELECT id, chapter_id, title, duration_minutes, total_marks, scheduled_at, ends_at
                 FROM exams
                WHERE chapter_id IN (${chapterPlaceholders}) AND status = 'published'
                ORDER BY sort_order ASC, scheduled_at DESC`,
              chapterIds,
            );
          } catch {
            // scheduled_at/ends_at columns may not exist on older DBs.
            return await query<ExamRow[]>(
              `SELECT id, chapter_id, title, duration_minutes, total_marks
                 FROM exams
                WHERE chapter_id IN (${chapterPlaceholders}) AND status = 'published'
                ORDER BY sort_order ASC`,
              chapterIds,
            );
          }
        },
        [],
      ),
    ]);
  }

  return buildCourseData(catalog, syntheticEnrollment, subjects, new Map(), new Set(), {
    papers,
    chapters,
    classes,
    materials,
    exams,
  });
}

// ── Course progress (subject-wise + chapter-wise) ────────────────────────

export type ChapterProgress = {
  chapterId: string;
  chapterName: string;
  totalClasses: number;
  completedClasses: number;
  percent: number;
};

export type SubjectProgress = {
  subjectId: string;
  subjectName: string;
  totalClasses: number;
  completedClasses: number;
  percent: number;
  chapters: ChapterProgress[];
};

export type CourseProgressDetail = {
  slug: string;
  name: string;
  imageUrl: string;
  totalClasses: number;
  completedClasses: number;
  remainingClasses: number;
  percent: number;
  subjects: SubjectProgress[];
};

type SubjectProgressRow = {
  course_slug: string;
  subject_id: string;
  subject_name: string;
  sort_order: number;
};

type ChapterProgressRow = {
  course_slug: string;
  subject_id: string | null;
  chapter_id: string;
  chapter_name: string | null;
  sort_order: number;
  total: number;
  done: number;
};

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/**
 * Real learning progress for every active enrollment (free + paid),
 * computed in MySQL from actual learning activity.
 *
 * Applicable content = active classes (course_classes) reachable through
 * the EXISTING content structure — both the subject path
 * (course_subject_assignments, course_slug-isolated) and the direct path
 * (course_chapters scoped by course_slug with no subject). No duplicate
 * course/content system is created.
 *
 * Completed content = rows in the existing student_class_progress table
 * with completed = 1 for THIS authenticated student — persisted per
 * account (UNIQUE student_uid + class_id, never duplicated), so refresh,
 * logout/login and other devices all read the same saved progress.
 *
 * Every actively enrolled course is returned: courses without content or
 * without any completion report 0%; a fully completed course reports 100%.
 */
export async function getMyCourseProgress(
  uid: string,
): Promise<CourseProgressDetail[]> {
  // 1) All active enrollments — free and paid. These define the course list;
  //    progress rows below can only add numbers, never remove a course.
  const enrollments = await query<
    { course_id: string; course_name: string | null; course_kind: string }[]
  >(
    `SELECT course_id, course_name, course_kind FROM enrollments
      WHERE student_uid = ? AND enrollment_status = 'active'`,
    [uid],
  );
  if (enrollments.length === 0) return [];

  const slugs = enrollments.map((row) => row.course_id);
  const placeholders = slugs.map(() => "?").join(",");

  // 2) Catalog display info where a catalog row exists (legacy enrollments
  //    may reference a course id with no catalog row — fall back to the
  //    enrollment's stored course name, never drop the course).
  const catalogRows = await safe<{ slug: string; name: string | null; image_url: string | null }[]>(
    "progress catalog query",
    () =>
      query<{ slug: string; name: string | null; image_url: string | null }[]>(
        `SELECT slug, name, image_url FROM catalog_courses WHERE slug IN (${placeholders})`,
        slugs,
      ),
    [],
  );
  const catalogBySlug = new Map(
    catalogRows.map((row) => [row.slug, row]),
  );

  // 3) Assigned subjects (subject path) + per-chapter class counts for BOTH
  //    paths. LEFT JOINs keep empty subjects/chapters visible with 0 counts.
  const [subjectRows, subjectChapters, directChapters] = await Promise.all([
    safe<SubjectProgressRow[]>(
      "progress subjects query",
      () =>
        query<SubjectProgressRow[]>(
          `SELECT a.course_slug, s.id AS subject_id, s.name AS subject_name, s.sort_order
             FROM course_subject_assignments a
             JOIN course_subjects s ON s.id = a.subject_id AND s.is_active = 1
            WHERE a.course_slug IN (${placeholders})
            ORDER BY a.course_slug, s.sort_order, s.name`,
          slugs,
        ),
      [],
    ),
    safe<ChapterProgressRow[]>(
      "progress subject-chapters query",
      () =>
        query<ChapterProgressRow[]>(
          `SELECT a.course_slug, ch.subject_id,
                  ch.id AS chapter_id, ch.name AS chapter_name, ch.sort_order,
                  COUNT(cl.id) AS total,
                  SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS done
             FROM course_subject_assignments a
             JOIN course_subjects s ON s.id = a.subject_id AND s.is_active = 1
             LEFT JOIN course_chapters ch
               ON ch.subject_id = s.id AND ch.is_active = 1
              AND (COALESCE(ch.course_slug, '') = '' OR ch.course_slug = a.course_slug)
             LEFT JOIN course_classes cl
               ON cl.chapter_id = ch.id AND cl.is_active = 1
             LEFT JOIN student_class_progress p
               ON p.class_id = cl.id AND p.student_uid = ?
            WHERE a.course_slug IN (${placeholders})
            GROUP BY a.course_slug, ch.subject_id, ch.id, ch.name, ch.sort_order
            ORDER BY a.course_slug, s.sort_order, s.name, ch.sort_order, ch.name`,
          [uid, ...slugs],
        ),
      [],
    ),
    safe<ChapterProgressRow[]>(
      "progress direct-chapters query",
      () =>
        query<ChapterProgressRow[]>(
          `SELECT ch.course_slug, NULL AS subject_id,
                  ch.id AS chapter_id, ch.name AS chapter_name, ch.sort_order,
                  COUNT(cl.id) AS total,
                  SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS done
             FROM course_chapters ch
             LEFT JOIN course_classes cl
               ON cl.chapter_id = ch.id AND cl.is_active = 1
             LEFT JOIN student_class_progress p
               ON p.class_id = cl.id AND p.student_uid = ?
            WHERE ch.is_active = 1
              AND ch.course_slug IN (${placeholders})
              AND COALESCE(ch.subject_id, '') = ''
            GROUP BY ch.course_slug, ch.id, ch.name, ch.sort_order
            ORDER BY ch.course_slug, ch.sort_order, ch.name`,
          [uid, ...slugs],
        ),
      [],
    ),
  ]);

  const courses = new Map<
    string,
    CourseProgressDetail & { subjectMap: Map<string, SubjectProgress> }
  >();
  const ensureCourse = (slug: string): CourseProgressDetail & { subjectMap: Map<string, SubjectProgress> } => {
    let course = courses.get(slug);
    if (!course) {
      const enrollment = enrollments.find((row) => row.course_id === slug);
      const catalog = catalogBySlug.get(slug);
      course = {
        slug,
        name:
          toStringOrNull(catalog?.name) ??
          toStringOrNull(enrollment?.course_name) ??
          slug,
        imageUrl: toStringOrNull(catalog?.image_url) ?? "",
        totalClasses: 0,
        completedClasses: 0,
        remainingClasses: 0,
        percent: 0,
        subjects: [],
        subjectMap: new Map(),
      };
      courses.set(slug, course);
    }
    return course;
  };
  const ensureSubject = (
    course: CourseProgressDetail & { subjectMap: Map<string, SubjectProgress> },
    subjectId: string,
    subjectName: string,
  ): SubjectProgress => {
    let subject = course.subjectMap.get(subjectId);
    if (!subject) {
      subject = {
        subjectId,
        subjectName,
        totalClasses: 0,
        completedClasses: 0,
        percent: 0,
        chapters: [],
      };
      course.subjectMap.set(subjectId, subject);
      course.subjects.push(subject);
    }
    return subject;
  };

  // Every enrolled course is present even before any content rows arrive.
  for (const row of enrollments) ensureCourse(row.course_id);
  // Subjects with no chapters yet still appear (0% subject-wise progress).
  for (const row of subjectRows) {
    ensureSubject(ensureCourse(row.course_slug), row.subject_id, row.subject_name);
  }

  const applyChapter = (
    courseSlug: string,
    subjectId: string | null,
    subjectName: string | null,
    chapterId: string | null,
    chapterName: string | null,
    total: number,
    done: number,
  ) => {
    const course = ensureCourse(courseSlug);
    course.totalClasses += total;
    course.completedClasses += done;
    if (!subjectId) return;
    const subject = ensureSubject(
      course,
      subjectId,
      subjectName ?? subjectId,
    );
    subject.totalClasses += total;
    subject.completedClasses += done;
    if (chapterId) {
      subject.chapters.push({
        chapterId,
        chapterName: chapterName ?? "",
        totalClasses: total,
        completedClasses: done,
        percent: percentOf(done, total),
      });
    }
  };

  for (const row of subjectChapters) {
    if (!row.chapter_id) continue;
    const subjectInfo = subjectRows.find(
      (item) => item.course_slug === row.course_slug && item.subject_id === row.subject_id,
    );
    applyChapter(
      row.course_slug,
      row.subject_id,
      subjectInfo?.subject_name ?? row.subject_id ?? "",
      row.chapter_id,
      row.chapter_name,
      toNumber(row.total),
      toNumber(row.done),
    );
  }
  // Direct-path chapters are grouped under one synthetic subject named after
  // the course so subject-wise progress still renders for direct courses.
  for (const row of directChapters) {
    if (!row.chapter_id) continue;
    const course = ensureCourse(row.course_slug);
    applyChapter(
      row.course_slug,
      "__direct__",
      course.name,
      row.chapter_id,
      row.chapter_name,
      toNumber(row.total),
      toNumber(row.done),
    );
  }

  return [...courses.values()].map((course) => ({
    slug: course.slug,
    name: course.name,
    imageUrl: course.imageUrl,
    totalClasses: course.totalClasses,
    completedClasses: course.completedClasses,
    remainingClasses: Math.max(0, course.totalClasses - course.completedClasses),
    percent: percentOf(course.completedClasses, course.totalClasses),
    subjects: course.subjects.map((subject) => ({
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      totalClasses: subject.totalClasses,
      completedClasses: subject.completedClasses,
      percent: percentOf(subject.completedClasses, subject.totalClasses),
      chapters: subject.chapters,
    })),
  }));
}

// ── Recently viewed ───────────────────────────────────────────────────────

export type RecentItemType = "course" | "class" | "exam" | "material";

export type RecentViewItem = {
  itemType: RecentItemType;
  itemId: string;
  title: string;
  subtitle: string;
  href: string;
  external: boolean;
  viewedAt: string;
};

const RECENT_ITEM_TYPES: RecentItemType[] = [
  "course",
  "class",
  "exam",
  "material",
];

/** Record one view. Silently ignores items outside the student's enrollment. */
export async function recordRecentView(
  uid: string,
  itemType: RecentItemType,
  itemId: string,
): Promise<boolean> {
  if (!RECENT_ITEM_TYPES.includes(itemType) || !itemId || itemId.length > 191) {
    return false;
  }
  try {
    // Enrollment check — only content inside an actively enrolled course
    // (or the course itself) may enter the history.
    let allowed = false;
    if (itemType === "course") {
      allowed = await hasActiveEnrollment(uid, itemId);
    } else {
      const rows = await query<{ found: number }[]>(
        `SELECT 1 AS found
           FROM enrollments e
           JOIN course_subject_assignments a ON a.course_slug = e.course_id
           JOIN course_chapters ch ON ch.subject_id = a.subject_id
      LEFT JOIN course_classes cl ON cl.chapter_id = ch.id AND ? = 'class' AND cl.id = ?
      LEFT JOIN exams ex ON ex.chapter_id = ch.id AND ? = 'exam' AND ex.id = ?
      LEFT JOIN course_materials m ON m.chapter_id = ch.id AND ? = 'material' AND m.id = ?
          WHERE e.student_uid = ? AND e.enrollment_status = 'active'
            AND (cl.id IS NOT NULL OR ex.id IS NOT NULL OR m.id IS NOT NULL)
          LIMIT 1`,
        [
          itemType,
          itemType === "class" ? itemId : "",
          itemType,
          itemType === "exam" ? itemId : "",
          itemType,
          itemType === "material" ? itemId : "",
          uid,
        ],
      );
      allowed = rows.length > 0;
    }
    if (!allowed) return false;

    await query(
      `INSERT INTO student_recent_views (student_uid, item_type, item_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE viewed_at = CURRENT_TIMESTAMP`,
      [uid, itemType, itemId],
    );
    return true;
  } catch {
    return false;
  }
}

type RecentClassRow = {
  item_id: string;
  title: string;
  course_name: string;
  course_slug: string;
  duration_minutes: number;
  viewed_at: Date | string;
};

type RecentCourseRow = {
  item_id: string;
  name: string;
  category: string;
  viewed_at: Date | string;
};

type RecentExamRow = {
  item_id: string;
  title: string;
  duration_minutes: number;
  total_marks: number;
  course_name: string;
  viewed_at: Date | string;
};

type RecentMaterialRow = {
  item_id: number | string;
  title: string;
  material_type: string;
  file_url: string;
  course_name: string;
  viewed_at: Date | string;
};

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** The student's view history — newest first, deduped per item. */
export async function getRecentlyViewed(
  uid: string,
  limit = 30,
): Promise<RecentViewItem[]> {
  try {
    const [courseRows, classRows, examRows, materialRows] = await Promise.all([
      query<RecentCourseRow[]>(
        `SELECT r.item_id, c.name, c.category, r.viewed_at
           FROM student_recent_views r
           JOIN catalog_courses c ON c.slug = r.item_id
           JOIN enrollments e ON e.course_id = r.item_id AND e.student_uid = ?
                AND e.enrollment_status = 'active'
          WHERE r.student_uid = ? AND r.item_type = 'course'
          ORDER BY r.viewed_at DESC LIMIT ${limit}`,
        [uid, uid],
      ),
      query<RecentClassRow[]>(
        `SELECT r.item_id, cl.title, cc.name AS course_name, cc.slug AS course_slug,
                cl.duration_minutes, r.viewed_at
           FROM student_recent_views r
           JOIN course_classes cl ON cl.id = r.item_id AND cl.is_active = 1
           JOIN course_chapters ch ON ch.id = cl.chapter_id
           JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
           JOIN catalog_courses cc ON cc.slug = a.course_slug
           JOIN enrollments e ON e.course_id = a.course_slug AND e.student_uid = ?
                AND e.enrollment_status = 'active'
          WHERE r.student_uid = ? AND r.item_type = 'class'
          ORDER BY r.viewed_at DESC LIMIT ${limit}`,
        [uid, uid],
      ),
      query<RecentExamRow[]>(
        `SELECT r.item_id, ex.title, ex.duration_minutes, ex.total_marks,
                cc.name AS course_name, r.viewed_at
           FROM student_recent_views r
           JOIN exams ex ON ex.id = r.item_id AND ex.status = 'published'
           LEFT JOIN course_chapters ch ON ch.id = ex.chapter_id
           LEFT JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
           LEFT JOIN catalog_courses cc ON cc.slug = a.course_slug
           JOIN enrollments e ON e.course_id = a.course_slug AND e.student_uid = ?
                AND e.enrollment_status = 'active'
          WHERE r.student_uid = ? AND r.item_type = 'exam'
          ORDER BY r.viewed_at DESC LIMIT ${limit}`,
        [uid, uid],
      ),
      query<RecentMaterialRow[]>(
        `SELECT r.item_id, m.title, m.material_type, m.file_url,
                cc.name AS course_name, r.viewed_at
           FROM student_recent_views r
           JOIN course_materials m ON m.id = r.item_id AND m.is_active = 1
           JOIN course_chapters ch ON ch.id = m.chapter_id
           JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
           JOIN catalog_courses cc ON cc.slug = a.course_slug
           JOIN enrollments e ON e.course_id = a.course_slug AND e.student_uid = ?
                AND e.enrollment_status = 'active'
          WHERE r.student_uid = ? AND r.item_type = 'material'
          ORDER BY r.viewed_at DESC LIMIT ${limit}`,
        [uid, uid],
      ),
    ]);

    const items: RecentViewItem[] = [];

    for (const row of courseRows) {
      items.push({
        itemType: "course",
        itemId: row.item_id,
        title: row.name ?? row.item_id,
        subtitle: row.category || "Course",
        href: `/dashboard/enrolled-courses/${encodeURIComponent(row.item_id)}`,
        external: false,
        viewedAt: toIso(row.viewed_at),
      });
    }
    for (const row of classRows) {
      items.push({
        itemType: "class",
        itemId: row.item_id,
        title: row.title,
        subtitle: `${row.duration_minutes > 0 ? row.duration_minutes + " min · " : ""}${row.course_name ?? ""}`,
        href: `/dashboard/enrolled-courses/${encodeURIComponent(row.course_slug)}/classes/${encodeURIComponent(row.item_id)}`,
        external: false,
        viewedAt: toIso(row.viewed_at),
      });
    }
    for (const row of examRows) {
      items.push({
        itemType: "exam",
        itemId: row.item_id,
        title: row.title,
        subtitle: `${row.duration_minutes > 0 ? row.duration_minutes + " min · " : ""}${row.total_marks > 0 ? row.total_marks + " marks · " : ""}${row.course_name ?? "Exam"}`,
        href: `/exam/${encodeURIComponent(row.item_id)}/rules`,
        external: false,
        viewedAt: toIso(row.viewed_at),
      });
    }
    for (const row of materialRows) {
      items.push({
        itemType: "material",
        itemId: String(row.item_id),
        title: row.title,
        subtitle: `${row.material_type.toUpperCase()} · ${row.course_name ?? ""}`,
        href: row.file_url,
        external: true,
        viewedAt: toIso(row.viewed_at),
      });
    }

    items.sort((a, b) => b.viewedAt.localeCompare(a.viewedAt));
    return items.slice(0, limit);
  } catch {
    return [];
  }
}

// ── Continue Learning (resume where the student stopped) ─────────────────

export type ContinueLearningItem = {
  slug: string;
  courseName: string;
  imageUrl: string;
  subjectName: string;
  chapterName: string;
  classId: string;
  classTitle: string;
  lastSeenSeconds: number;
  progress: {
    totalClasses: number;
    completedClasses: number;
    percent: number;
  };
};

type CurriculumClassRow = {
  course_slug: string;
  course_name: string;
  image_url: string | null;
  class_id: string;
  class_title: string;
  chapter_name: string;
  subject_name: string;
};

type ProgressStampRow = {
  class_id: string;
  completed: number;
  last_seen_seconds: number;
  updated_at: Date | string;
};

/**
 * One "pick up where you left off" entry per enrolled course, straight from
 * MySQL — no static data. The target class is, in order of preference:
 *   1. the most recently touched INCOMPLETE class in that course,
 *   2. the first incomplete class in curriculum order.
 * Courses with no classes or everything completed are skipped.
 */
export async function getContinueLearningItems(
  uid: string,
): Promise<ContinueLearningItem[]> {
  const enrolled = await getMyEnrolledCourses(uid);
  if (enrolled.length === 0) return [];
  const slugs = enrolled.map((course) => course.slug);
  const placeholders = slugs.map(() => "?").join(",");

  const [subjectCurriculum, directCurriculum, stamps] = await Promise.all([
    query<CurriculumClassRow[]>(
      `SELECT a.course_slug, COALESCE(NULLIF(c.name, ''), e.course_name) AS course_name, c.image_url,
              cl.id AS class_id, cl.title AS class_title,
              ch.name AS chapter_name, s.name AS subject_name
         FROM course_subject_assignments a
         JOIN enrollments e ON e.course_id = a.course_slug AND e.student_uid = ?
              AND e.enrollment_status = 'active'
         LEFT JOIN catalog_courses c ON c.slug = a.course_slug
         JOIN course_subjects s ON s.id = a.subject_id AND s.is_active = 1
         JOIN course_chapters ch ON ch.subject_id = a.subject_id AND ch.is_active = 1
              AND (COALESCE(ch.course_slug, '') = '' OR ch.course_slug = a.course_slug)
         JOIN course_classes cl ON cl.chapter_id = ch.id AND cl.is_active = 1
        WHERE a.course_slug IN (${placeholders})
        ORDER BY a.course_slug, s.sort_order, s.name,
                 ch.sort_order, ch.name, cl.sort_order, cl.created_at`,
      [uid, ...slugs],
    ),
    query<CurriculumClassRow[]>(
      `SELECT ch.course_slug, COALESCE(NULLIF(c.name, ''), e.course_name) AS course_name, c.image_url,
              cl.id AS class_id, cl.title AS class_title,
              ch.name AS chapter_name, COALESCE(NULLIF(c.name, ''), e.course_name) AS subject_name
         FROM course_chapters ch
         JOIN enrollments e ON e.course_id = ch.course_slug AND e.student_uid = ?
              AND e.enrollment_status = 'active'
         LEFT JOIN catalog_courses c ON c.slug = ch.course_slug
         JOIN course_classes cl ON cl.chapter_id = ch.id AND cl.is_active = 1
        WHERE ch.is_active = 1
          AND ch.course_slug IN (${placeholders})
          AND COALESCE(ch.subject_id, '') = ''
        ORDER BY ch.course_slug, ch.sort_order, ch.name, cl.sort_order, cl.created_at`,
      [uid, ...slugs],
    ),
    query<ProgressStampRow[]>(
      `SELECT p.class_id, p.completed, p.last_seen_seconds, p.updated_at
         FROM student_class_progress p
        WHERE p.student_uid = ?`,
      [uid],
    ),
  ]);
  const curriculum = [...subjectCurriculum, ...directCurriculum];

  if (curriculum.length === 0) return [];

  // Progress lookup + per-course activity recency.
  const stampByClass = new Map(
    stamps.map((row) => [
      row.class_id,
      {
        completed: row.completed === 1,
        lastSeenSeconds: toNumber(row.last_seen_seconds),
        updatedAt:
          row.updated_at instanceof Date
            ? row.updated_at.getTime()
            : new Date(row.updated_at).getTime() || 0,
      },
    ]),
  );

  type CourseBucket = {
    slug: string;
    name: string;
    imageUrl: string;
    classes: CurriculumClassRow[];
    totalClasses: number;
    completedClasses: number;
    lastActivityAt: number;
  };
  const buckets = new Map<string, CourseBucket>();
  for (const row of curriculum) {
    let bucket = buckets.get(row.course_slug);
    if (!bucket) {
      bucket = {
        slug: row.course_slug,
        name: row.course_name,
        imageUrl: toStringOrNull(row.image_url) ?? "",
        classes: [],
        totalClasses: 0,
        completedClasses: 0,
        lastActivityAt: 0,
      };
      buckets.set(row.course_slug, bucket);
    }
    bucket.classes.push(row);
    bucket.totalClasses += 1;
    const stamp = stampByClass.get(row.class_id);
    if (stamp?.completed) bucket.completedClasses += 1;
    if (
      stamp &&
      stamp.lastSeenSeconds > 0 &&
      stamp.updatedAt > bucket.lastActivityAt
    ) {
      bucket.lastActivityAt = stamp.updatedAt;
    }
  }

  const items: (ContinueLearningItem & { lastActivityAt: number })[] = [];
  for (const bucket of buckets.values()) {
    // Most recently touched incomplete class; otherwise first incomplete.
    let target: CurriculumClassRow | undefined;
    let resumeSeconds = 0;
    let bestTouchedAt = 0;
    for (const row of bucket.classes) {
      const stamp = stampByClass.get(row.class_id);
      if (!stamp || stamp.completed) continue;
      // First incomplete class in curriculum order — the default target.
      if (!target) {
        target = row;
        resumeSeconds = stamp.lastSeenSeconds;
      }
      // Prefer the incomplete class the student watched most recently.
      if (stamp.lastSeenSeconds > 0 && stamp.updatedAt > bestTouchedAt) {
        bestTouchedAt = stamp.updatedAt;
        target = row;
        resumeSeconds = stamp.lastSeenSeconds;
      }
    }
    // Everything completed → nothing left to continue in this course.
    if (!target) continue;

    items.push({
      slug: bucket.slug,
      courseName: bucket.name,
      imageUrl: bucket.imageUrl,
      subjectName: target.subject_name,
      chapterName: target.chapter_name,
      classId: target.class_id,
      classTitle: target.class_title,
      lastSeenSeconds: resumeSeconds,
      progress: {
        totalClasses: bucket.totalClasses,
        completedClasses: bucket.completedClasses,
        percent:
          bucket.totalClasses > 0
            ? Math.round((bucket.completedClasses / bucket.totalClasses) * 100)
            : 0,
      },
      lastActivityAt: bucket.lastActivityAt,
    });
  }

  // Most recently active course first.
  items.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return items.map(({ lastActivityAt: _lastActivityAt, ...item }) => item);
}
