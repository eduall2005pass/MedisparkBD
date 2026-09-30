import { exec, query } from "@/lib/mysql";

/**
 * Admin Panel → Notification Control → Automatic notifications engine.
 *
 * Every automatic notification in the three scopes (All Students / Enrolled
 * Students / Specific Student) flows through `fireAutoNotification`, which
 * guarantees:
 *  - real events only (callers hook real DB writes / real exam time),
 *  - exactly-once delivery per event (atomic INSERT IGNORE ledger on
 *    `notification_events` — refreshes and repeated reads never resend),
 *  - correct scope isolation (audience + target uid / course id),
 *  - admin-configurable templates via `notification_settings`.
 *
 * Manual notifications NEVER pass through here (admin API forces
 * origin "manual"), and automatic rows are always stored with
 * origin "automatic" so the two can never be mixed up.
 */

export type AutoEventScope = "all" | "enrolled" | "specific";

export type AutoEventDef = {
  /** Stable settings key, e.g. "auto_all_registration". */
  key: string;
  scope: AutoEventScope;
  label: string;
  description: string;
  defaultTitle: string;
  defaultMessage: string;
  /** Template placeholders supported by this event. */
  placeholders: string[];
};

export const AUTO_EVENT_DEFS: AutoEventDef[] = [
  // ── Card 1 · All Students ────────────────────────────────────────────
  {
    key: "auto_all_registration",
    scope: "all",
    label: "New Registration",
    description:
      "Sent to the student when they successfully register an account.",
    defaultTitle: "Welcome to MediSpark!",
    defaultMessage:
      "Welcome to MediSpark Academic & Admission Care. Your learning journey starts here. Explore our courses, exams and learning resources.",
    placeholders: ["{studentName}"],
  },
  {
    key: "auto_all_course",
    scope: "all",
    label: "New Course Published",
    description:
      "Sent to all students when a new course is published on the main website.",
    defaultTitle: "New Course Available",
    defaultMessage:
      "A new course ({courseName}) has been added to MediSpark. Explore the course and enroll now.",
    placeholders: ["{courseName}"],
  },
  {
    key: "auto_all_exam",
    scope: "all",
    label: "New Public Exam Published",
    description:
      "Sent to all students when a new Public Exam becomes available.",
    defaultTitle: "New Public Exam Available",
    defaultMessage:
      "A new public exam ({examName}) has been added. Participate now and test your preparation.",
    placeholders: ["{examName}"],
  },
  // ── Card 2 · Enrolled Students (course-scoped) ───────────────────────
  {
    key: "auto_enrolled_class",
    scope: "enrolled",
    label: "New Class Added",
    description:
      "Sent ONLY to students enrolled in the course the class was added to.",
    defaultTitle: "New Class Added",
    defaultMessage:
      "A new class ({className}) has been added to {courseName}. Open your course and start learning now.",
    placeholders: ["{className}", "{courseName}"],
  },
  {
    key: "auto_enrolled_exam",
    scope: "enrolled",
    label: "New Course Exam Added",
    description:
      "Sent ONLY to students enrolled in the course the exam was added to.",
    defaultTitle: "New Exam Added",
    defaultMessage:
      "A new exam ({examName}) has been added to {courseName}. Check the exam and prepare yourself.",
    placeholders: ["{examName}", "{courseName}"],
  },
  {
    key: "auto_enrolled_live",
    scope: "enrolled",
    label: "Exam Becomes Live",
    description:
      "Sent ONCE when a course exam changes from Upcoming to Live — only to students enrolled in that course.",
    defaultTitle: "Exam Is Live Now",
    defaultMessage:
      "The {examName} is live now. Participate in the exam and test your preparation.",
    placeholders: ["{examName}", "{courseName}"],
  },
  {
    key: "auto_enrolled_material",
    scope: "enrolled",
    label: "New Material Added",
    description:
      "Sent ONLY to students enrolled in the course the material was added to.",
    defaultTitle: "New Material Added",
    defaultMessage:
      "New study material ({materialName}) has been added to {courseName}. Open your course and start learning now.",
    placeholders: ["{materialName}", "{courseName}"],
  },
  // ── Card 3 · Specific Student ────────────────────────────────────────
  {
    key: "auto_specific_enrollment",
    scope: "specific",
    label: "Enrollment Confirmation",
    description:
      "Sent to the exact student when their enrollment in a course becomes active.",
    defaultTitle: "Enrollment Successful",
    defaultMessage:
      "You have successfully enrolled in {courseName}. Start your learning journey now.",
    placeholders: ["{courseName}", "{studentName}"],
  },
];

export type AutoSetting = {
  key: string;
  enabled: boolean;
  title: string;
  message: string;
};

let settingsTableReady = false;

async function ensureSettingsTable(): Promise<void> {
  if (settingsTableReady) return;
  // Reference mirror: src/sql/notification-control-migration.sql.
  await exec(`CREATE TABLE IF NOT EXISTS notification_settings (
    scope_key VARCHAR(64) NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    title_template VARCHAR(255) NULL,
    message_template TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  settingsTableReady = true;
}

/** Merge stored overrides over the built-in defaults (defaults win when unset). */
export async function getAutoNotificationSettings(): Promise<AutoSetting[]> {
  await ensureSettingsTable();
  let rows: Array<{
    scope_key: string;
    enabled: number | boolean;
    title_template: string | null;
    message_template: string | null;
  }> = [];
  try {
    rows = await query<
      Array<{
        scope_key: string;
        enabled: number | boolean;
        title_template: string | null;
        message_template: string | null;
      }>
    >(
      `SELECT scope_key, enabled, title_template, message_template FROM notification_settings`,
    );
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map((row) => [row.scope_key, row]));
  return AUTO_EVENT_DEFS.map((def) => {
    const stored = byKey.get(def.key);
    return {
      key: def.key,
      enabled: stored ? Boolean(stored.enabled) : true,
      title:
        stored?.title_template && stored.title_template.trim()
          ? stored.title_template
          : def.defaultTitle,
      message:
        stored?.message_template && stored.message_template.trim()
          ? stored.message_template
          : def.defaultMessage,
    };
  });
}

export async function saveAutoNotificationSetting(input: {
  key: string;
  enabled?: boolean;
  title?: string;
  message?: string;
}): Promise<AutoSetting[]> {
  const def = AUTO_EVENT_DEFS.find((item) => item.key === input.key);
  if (!def) throw new Error("Unknown automatic event.");
  await ensureSettingsTable();
  const current = (await getAutoNotificationSettings()).find(
    (item) => item.key === input.key,
  );
  const enabled = input.enabled ?? current?.enabled ?? true;
  const title = (input.title ?? current?.title ?? def.defaultTitle)
    .trim()
    .slice(0, 255);
  const message = (input.message ?? current?.message ?? def.defaultMessage)
    .trim()
    .slice(0, 2000);
  if (title.length < 2) throw new Error("Title is required.");
  if (message.length < 2) throw new Error("Message is required.");
  await exec(
    `INSERT INTO notification_settings (scope_key, enabled, title_template, message_template)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
       title_template = VALUES(title_template),
       message_template = VALUES(message_template)`,
    [def.key, enabled ? 1 : 0, title, message],
  );
  return getAutoNotificationSettings();
}

/** Fill {placeholders} in a template (unknown keys left untouched). */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

async function getSetting(key: string): Promise<AutoSetting | null> {
  const all = await getAutoNotificationSettings();
  return all.find((item) => item.key === key) ?? null;
}

/**
 * Fire one automatic notification exactly once per event key.
 *
 * Returns the notification id when sent, null when skipped (disabled,
 * duplicate, or DB error). Never throws — notification delivery must never
 * break the triggering flow (registration, enrollment, publishing).
 */
export async function fireAutoNotification(options: {
  settingsKey: string;
  eventKey: string;
  audience: "all" | "enrolled" | "student";
  vars?: Record<string, string>;
  targetUid?: string;
  targetEmail?: string;
  targetCourseId?: string;
}): Promise<string | null> {
  try {
    const { ensureNotificationTables } = await import("@/lib/content-admin");
    await ensureNotificationTables();
    const setting = await getSetting(options.settingsKey);
    if (!setting || !setting.enabled) return null;
    const eventKey = options.eventKey.trim().slice(0, 191);
    if (!eventKey) return null;

    // Atomic once-only guard: the first insert wins, repeats are ignored.
    const claimed = await exec(
      `INSERT IGNORE INTO notification_events (event_key) VALUES (?)`,
      [eventKey],
    );
    if (claimed.affectedRows === 0) return null;

    const title = renderTemplate(setting.title, options.vars ?? {});
    const message = renderTemplate(setting.message, options.vars ?? {});
    if (title.trim().length < 2 || message.trim().length < 2) {
      await exec(`DELETE FROM notification_events WHERE event_key = ?`, [
        eventKey,
      ]).catch(() => undefined);
      return null;
    }
    const id = `ntf-auto-${Date.now()}-${Math.floor(Math.random() * 1e6)
      .toString()
      .padStart(6, "0")}`;
    try {
      await exec(
        `INSERT INTO notifications
           (id, title, message, audience, is_active, created_by,
            target_uid, target_email, target_course_id, origin, event_key)
         VALUES (?, ?, ?, ?, 1, 'system-auto', ?, ?, ?, 'automatic', ?)`,
        [
          id,
          title.trim().slice(0, 255),
          message.trim(),
          options.audience,
          options.targetUid?.trim() || null,
          options.targetEmail?.trim().toLowerCase() || null,
          options.targetCourseId?.trim().slice(0, 191) || null,
          eventKey,
        ],
      );
      await exec(
        `UPDATE notification_events SET notification_id = ? WHERE event_key = ?`,
        [id, eventKey],
      ).catch(() => undefined);
      return id;
    } catch {
      // Roll back the claim so a transient failure doesn't swallow the event.
      await exec(`DELETE FROM notification_events WHERE event_key = ?`, [
        eventKey,
      ]).catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }
}

// ── Course resolution helpers (real relationships, no duplication) ─────────

/** All course slugs a chapter belongs to (direct slug + subject assignments). */
export async function resolveCourseSlugsForChapter(
  chapterId: string,
): Promise<string[]> {
  const id = chapterId?.trim();
  if (!id) return [];
  try {
    const rows = await query<Array<{ course_slug: string | null }>>(
      `SELECT ch.course_slug AS course_slug
         FROM course_chapters ch WHERE ch.id = ? LIMIT 1`,
      [id],
    );
    const direct = rows[0]?.course_slug?.trim();
    const slugs: string[] = direct ? [direct] : [];
    try {
      const assigned = await query<Array<{ course_slug: string }>>(
        `SELECT a.course_slug AS course_slug
           FROM course_chapters ch
           JOIN course_subject_assignments a ON a.subject_id = ch.subject_id
          WHERE ch.id = ?`,
        [id],
      );
      for (const row of assigned) {
        const slug = row.course_slug?.trim();
        if (slug && !slugs.includes(slug)) slugs.push(slug);
      }
    } catch {
      // Assignment bridge may not exist on legacy DBs — direct slug is enough.
    }
    return slugs;
  } catch {
    return [];
  }
}

/** All course slugs an exam is linked to (exam_courses + chapter chain). */
export async function resolveCourseSlugsForExam(
  examId: string,
  chapterId?: string | null,
): Promise<string[]> {
  const slugs: string[] = [];
  try {
    const rows = await query<Array<{ course_id: string }>>(
      `SELECT course_id FROM exam_courses WHERE exam_id = ?`,
      [examId],
    );
    for (const row of rows) {
      const slug = row.course_id?.trim();
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
  } catch {
    // exam_courses may not exist on legacy DBs — fall through to chapter chain.
  }
  if (chapterId) {
    for (const slug of await resolveCourseSlugsForChapter(chapterId)) {
      if (!slugs.includes(slug)) slugs.push(slug);
    }
  }
  return slugs;
}

/** Human-readable course name for templates (falls back to the slug). */
export async function resolveCourseName(slug: string): Promise<string> {
  try {
    const { fetchCatalogCourse } = await import("@/lib/courses-admin");
    const course = await fetchCatalogCourse(slug);
    if (course?.name) return course.name;
  } catch {
    // Fall through to slug.
  }
  return slug;
}

// ── Named event entry points (called from real write/read sites) ───────────

export async function notifyRegistration(input: {
  uid: string;
  email?: string;
  name?: string;
}): Promise<void> {
  if (!input.uid?.trim()) return;
  await fireAutoNotification({
    settingsKey: "auto_all_registration",
    eventKey: `auto:registration:${input.uid.trim()}`,
    audience: "student",
    vars: { studentName: input.name?.trim() || "Student" },
    targetUid: input.uid.trim(),
    targetEmail: input.email,
  });
}

export async function notifyEnrollmentConfirmed(input: {
  uid: string;
  email?: string;
  name?: string;
  courseId: string;
  courseName?: string;
}): Promise<void> {
  const uid = input.uid?.trim();
  const courseId = input.courseId?.trim();
  if (!uid || !courseId) return;
  await fireAutoNotification({
    settingsKey: "auto_specific_enrollment",
    eventKey: `auto:enrollment:${uid}:${courseId}`,
    audience: "student",
    vars: {
      courseName: input.courseName?.trim() || (await resolveCourseName(courseId)),
      studentName: input.name?.trim() || "Student",
    },
    targetUid: uid,
    targetEmail: input.email,
  });
}

export async function notifyCoursePublished(courseSlug: string): Promise<void> {
  const slug = courseSlug?.trim();
  if (!slug) return;
  await fireAutoNotification({
    settingsKey: "auto_all_course",
    eventKey: `auto:course-published:${slug}`,
    audience: "all",
    vars: { courseName: await resolveCourseName(slug) },
  });
}

export async function notifyPublicExamPublished(
  examId: string,
  examName: string,
): Promise<void> {
  if (!examId?.trim() || !examName?.trim()) return;
  await fireAutoNotification({
    settingsKey: "auto_all_exam",
    eventKey: `auto:public-exam-published:${examId.trim()}`,
    audience: "all",
    vars: { examName: examName.trim() },
  });
}

export async function notifyCourseExamAdded(input: {
  examId: string;
  examName: string;
  courseSlugs: string[];
}): Promise<void> {
  if (!input.examId?.trim() || input.courseSlugs.length === 0) return;
  for (const slug of input.courseSlugs) {
    await fireAutoNotification({
      settingsKey: "auto_enrolled_exam",
      eventKey: `auto:course-exam-added:${input.examId.trim()}:${slug}`,
      audience: "enrolled",
      vars: {
        examName: input.examName.trim() || "New Exam",
        courseName: await resolveCourseName(slug),
      },
      targetCourseId: slug,
    });
  }
}

export async function notifyClassAdded(input: {
  classId: string;
  className: string;
  chapterId: string;
}): Promise<void> {
  if (!input.classId?.trim()) return;
  const slugs = await resolveCourseSlugsForChapter(input.chapterId);
  for (const slug of slugs) {
    await fireAutoNotification({
      settingsKey: "auto_enrolled_class",
      eventKey: `auto:class-added:${input.classId.trim()}:${slug}`,
      audience: "enrolled",
      vars: {
        className: input.className.trim() || "New Class",
        courseName: await resolveCourseName(slug),
      },
      targetCourseId: slug,
    });
  }
}

export async function notifyMaterialAdded(input: {
  materialKey: string;
  materialName: string;
  chapterId: string;
}): Promise<void> {
  if (!input.materialKey?.trim()) return;
  const slugs = await resolveCourseSlugsForChapter(input.chapterId);
  for (const slug of slugs) {
    await fireAutoNotification({
      settingsKey: "auto_enrolled_material",
      eventKey: `auto:material-added:${input.materialKey.trim()}:${slug}`,
      audience: "enrolled",
      vars: {
        materialName: input.materialName.trim() || "New Material",
        courseName: await resolveCourseName(slug),
      },
      targetCourseId: slug,
    });
  }
}

/**
 * Exam-live sweep — fires "Exam Is Live Now" for every currently-live
 * course exam, once per (exam, course). Triggered ONLY by real reads
 * (student exam detail views + admin sweep endpoint), and each event fires
 * at most once thanks to the ledger — refreshing never resends.
 *
 * An exam counts as live exactly when: status = published AND
 * scheduled_at <= NOW() AND (ends_at IS NULL OR ends_at >= NOW()).
 */
export async function sweepLiveCourseExams(): Promise<number> {
  try {
    const rows = await query<
      Array<{
        id: string;
        title: string;
        kind: string;
        chapter_id: string | null;
      }>
    >(
      `SELECT id, title, kind, chapter_id FROM exams
        WHERE status = 'published'
          AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
          AND (ends_at IS NULL OR ends_at >= NOW())
        LIMIT 50`,
    );
    let fired = 0;
    for (const row of rows) {
      if (row.kind !== "enrolled") continue;
      const slugs = await resolveCourseSlugsForExam(row.id, row.chapter_id);
      for (const slug of slugs) {
        const sent = await fireAutoNotification({
          settingsKey: "auto_enrolled_live",
          eventKey: `auto:exam-live:${row.id}:${slug}`,
          audience: "enrolled",
          vars: {
            examName: row.title || "Exam",
            courseName: await resolveCourseName(slug),
          },
          targetCourseId: slug,
        });
        if (sent) fired += 1;
      }
    }
    return fired;
  } catch {
    return 0;
  }
}
