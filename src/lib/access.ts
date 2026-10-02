import { query } from "@/lib/mysql";

// ── MediSpark User Access & Permission System (server-side) ───────────────
//
// 4 levels:
//   guest      → not logged in (public content only)
//   registered → logged in with a completed student profile, no enrollment
//   free       → active enrollment in at least one FREE course
//   paid       → active enrollment in at least one PAID course (unlocks Q&A)
//
// Course-wise enforcement is always per course: every protected request must
// be checked against the CALLING user's uid + the REQUESTED course id.

export type AccessLevel = "guest" | "registered" | "free" | "paid";

export type ActiveEnrollment = {
  courseId: string;
  kind: "free" | "paid";
};

/** All ACTIVE enrollments of one student (course-wise permission source). */
export async function getActiveEnrollments(
  uid: string,
): Promise<ActiveEnrollment[]> {
  const rows = await query<{ course_id: string; course_kind: string }[]>(
    `SELECT course_id, course_kind FROM enrollments
      WHERE student_uid = ? AND enrollment_status = 'active'`,
    [uid],
  );
  return rows.map((row) => ({
    courseId: row.course_id,
    kind: row.course_kind === "paid" ? "paid" : "free",
  }));
}

/**
 * The student's overall level. Registered = profile exists but nothing
 * enrolled (the caller decides that); here we only classify enrollments.
 */
export async function getAccessLevel(
  uid: string,
  hasProfile = true,
): Promise<AccessLevel> {
  const enrollments = await getActiveEnrollments(uid);
  if (enrollments.length === 0) return hasProfile ? "registered" : "guest";
  return enrollments.some((enrollment) => enrollment.kind === "paid")
    ? "paid"
    : "free";
}

/** Q&A is available ONLY to students with an active PAID course (legacy helper). */
export async function hasPaidEnrollment(uid: string): Promise<boolean> {
  const enrollments = await getActiveEnrollments(uid);
  return enrollments.some((enrollment) => enrollment.kind === "paid");
}

/**
 * Course-level Q&A access: checks that the student has an ACTIVE enrollment
 * in the specific course, and that course has Q&A Access = ON (qa_access = 1).
 * Works independently for every course, regardless of whether Free or Paid.
 */
export async function canAccessCourseQa(
  uid: string,
  courseId: string,
): Promise<boolean> {
  if (!uid || !courseId) return false;
  try {
    const rows = await query<{ found: number }[]>(
      `SELECT 1 AS found
         FROM enrollments e
         JOIN catalog_courses c ON c.slug = e.course_id
        WHERE e.student_uid = ?
          AND e.course_id = ?
          AND e.enrollment_status = 'active'
          AND COALESCE(c.qa_access, 1) = 1
        LIMIT 1`,
      [uid, courseId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Check if student is actively enrolled in at least one course with Q&A Access = ON. */
export async function hasAnyQaAccess(uid: string): Promise<boolean> {
  if (!uid) return false;
  try {
    const rows = await query<{ found: number }[]>(
      `SELECT 1 AS found
         FROM enrollments e
         JOIN catalog_courses c ON c.slug = e.course_id
        WHERE e.student_uid = ?
          AND e.enrollment_status = 'active'
          AND COALESCE(c.qa_access, 1) = 1
        LIMIT 1`,
      [uid],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Course-wise protected-content check: this uid + THIS course only. */
export async function canAccessCourseContent(
  uid: string,
  courseId: string,
): Promise<boolean> {
  if (!courseId) return false;
  const rows = await query<{ found: number }[]>(
    `SELECT 1 AS found FROM enrollments
      WHERE student_uid = ? AND course_id = ? AND enrollment_status = 'active'
      LIMIT 1`,
    [uid, courseId],
  );
  return rows.length > 0;
}

/**
 * Whether a class/material/exam/qa item belongs to a course the student is
 * actively enrolled in (or is owned by the student for QA). Used to validate
 * item-level requests (favourites, progress, view history) so IDs cannot point
 * outside the enrollment.
 */
export async function itemInEnrolledCourse(
  uid: string,
  itemType: "class" | "material" | "exam" | "qa",
  itemId: string,
): Promise<boolean> {
  if (!itemId || itemId.length > 191) return false;
  try {
    let rows: { found: number }[] = [];
    if (itemType === "exam") {
      rows = await query<{ found: number }[]>(
        `SELECT 1 AS found
           FROM exams ex
           JOIN course_chapters ch ON ch.id = ex.chapter_id
           JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
           JOIN enrollments e ON e.course_id = a.course_slug
                AND e.student_uid = ? AND e.enrollment_status = 'active'
          WHERE ex.id = ? LIMIT 1`,
        [uid, itemId],
      );
      if (rows.length === 0) {
        // Course-level exams (chapter_id IS NULL)
        const enrolled = await query<{ found: number }[]>(
          `SELECT 1 AS found 
             FROM exams ex 
             JOIN exam_courses c ON c.exam_id = ex.id 
             JOIN enrollments e ON e.course_id = c.course_id 
            WHERE ex.id = ? 
              AND ex.chapter_id IS NULL 
              AND e.student_uid = ? 
              AND e.enrollment_status = 'active' 
            LIMIT 1`,
          [itemId, uid],
        );
        return enrolled.length > 0;
      }
    } else if (itemType === "qa") {
      // QA questions: allow if the student owns the question OR the question's subject/course
      // belongs to a course the student is enrolled in, or any paid enrollment (QA is paid-only feature).
      rows = await query<{ found: number }[]>(
        `SELECT 1 AS found FROM qa_questions q WHERE q.question_id = ? AND (q.student_uid = ? OR q.subject_id IN (
           SELECT s.id FROM course_subjects s
           JOIN course_subject_assignments a ON a.subject_id = s.id
           JOIN enrollments e ON e.course_id = a.course_slug AND e.student_uid = ? AND e.enrollment_status = 'active'
        )) LIMIT 1`,
        [itemId, uid, uid],
      );
      if (rows.length > 0) return true;
      // Fallback: any active paid enrollment (paid students may favourite any Q&A)
      const enrolled = await query<{ found: number }[]>(
        `SELECT 1 AS found FROM enrollments WHERE student_uid = ? AND enrollment_status = 'active' AND course_kind = 'paid' LIMIT 1`,
        [uid],
      );
      return enrolled.length > 0;
    } else {
      const table =
        itemType === "class" ? "course_classes cl" : "course_materials m";
      rows = await query<{ found: number }[]>(
        `SELECT 1 AS found
           FROM ${table}
           JOIN course_chapters ch ON ch.id = ${
             itemType === "class" ? "cl.chapter_id" : "m.chapter_id"
           }
           JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
           JOIN enrollments e ON e.course_id = a.course_slug
                AND e.student_uid = ? AND e.enrollment_status = 'active'
          WHERE ${itemType === "class" ? "cl.id" : "m.id"} = ? LIMIT 1`,
        [uid, itemId],
      );
    }
    return rows.length > 0;
  } catch {
    // On DB failure deny — never fail open.
    return false;
  }
}
