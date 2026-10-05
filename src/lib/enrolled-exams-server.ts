import { query } from "@/lib/mysql";
import { resolveDirectExamRoute, type EnrolledExamCourse } from "@/lib/enrolled-exams";

type EnrolledExamRow = {
  course_id: string;
  course_name: string;
  banner_image_url: string | null;
  content_layout: string | null;
};

export async function getMyEnrolledExams(uid: string): Promise<EnrolledExamCourse[]> {
  // Hidden courses remain accessible to active students; availability controls
  // public discovery, not enrollment access. Catalog deletion is a hard delete.
  // Never fall back to enrollment snapshots or load progress/content.
  const rows = await query<EnrolledExamRow[]>(
    `SELECT c.slug AS course_id, c.name AS course_name,
            c.image_url AS banner_image_url, c.content_layout
       FROM enrollments e
       INNER JOIN catalog_courses c ON c.slug = e.course_id
      WHERE e.student_uid = ?
        AND e.enrollment_status = 'active'
        AND c.status = 'published'
      ORDER BY e.updated_at DESC, c.slug ASC`,
    [uid],
    { cache: false },
  );
  return rows.map(toShortcut);
}

function toShortcut(row: EnrolledExamRow): EnrolledExamCourse {
  return {
    course_id: row.course_id,
    course_name: row.course_name,
    banner_image_url: row.banner_image_url ?? "",
    direct_exam_route_url: resolveDirectExamRoute(row.course_id, row.content_layout),
  };
}

export async function getMyEnrolledExamCourse(uid: string, courseId: string): Promise<EnrolledExamCourse | null> {
  const rows = await query<EnrolledExamRow[]>(
    `SELECT c.slug AS course_id, c.name AS course_name,
            c.image_url AS banner_image_url, c.content_layout
       FROM enrollments e
       INNER JOIN catalog_courses c ON c.slug = e.course_id
      WHERE e.student_uid = ? AND e.course_id = ?
        AND e.enrollment_status = 'active' AND c.status = 'published'
      LIMIT 1`,
    [uid, courseId],
    { cache: false },
  );
  return rows[0] ? toShortcut(rows[0]) : null;
}

/** Same active-enrollment gate as existing flow APIs, without the SELECT cache. */
export async function hasFreshActiveEnrollment(uid: string, courseId: string): Promise<boolean> {
  const rows = await query<{ found: number }[]>(
    "SELECT 1 AS found FROM enrollments WHERE student_uid = ? AND course_id = ? AND enrollment_status = 'active' LIMIT 1",
    [uid, courseId],
    { cache: false },
  );
  return rows.length > 0;
}
