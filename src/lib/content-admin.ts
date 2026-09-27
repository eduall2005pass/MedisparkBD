import { exec, query } from "@/lib/mysql";

let ensureNotificationsTableReady = false;
let ensureJerseysTableReady = false;
// Admin Panel → Content. Notifications broadcast + jersey catalog.
// Media library reads the shared `uploads` table (see src/lib/storage.ts).

export type NotificationAudience = "all" | "students" | "admins" | "enrolled" | "student";

export type NotificationOrigin = "manual" | "automatic";

export type Notification = {
  id: string;
  title: string;
  message: string;
  /** Optional click-through target (relative /path or absolute https URL). */
  link: string | null;
  audience: NotificationAudience;
  /** Targeted student uid (audience "student" only). */
  targetUid: string | null;
  targetEmail: string | null;
  /**
   * Targeted course slug (audience "enrolled" only). When set, the
   * notification is visible ONLY to students actively enrolled in THAT
   * course. Legacy "enrolled" rows with NULL keep the old behavior
   * (any active enrollment).
   */
  targetCourseId: string | null;
  /** Manual (admin-composed) vs automatic (system-event generated). */
  origin: NotificationOrigin;
  /** Once-only ledger key for automatic notifications (NULL for manual). */
  eventKey: string | null;
  isActive: boolean;
  createdAt: string;
  /**
   * Per-student read state (persisted in `notification_reads`, keyed by
   * notification + student uid). True when this student has read it.
   * Always false in the admin view (admins don't consume read state).
   */
  isRead: boolean;
};

export type JerseyItem = {
  id: string;
  name: string;
  note: string | null;
  image: string | null;
  link: string | null;
  price: number;
  isActive: boolean;
  featured: boolean;
};

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  audience: string;
  target_uid?: string | null;
  target_email?: string | null;
  target_course_id?: string | null;
  origin?: string | null;
  event_key?: string | null;
  is_active: number | boolean;
  created_at: Date | string;
};

type JerseyRow = {
  id: string;
  name: string;
  note: string | null;
  image_url: string | null;
  link: string | null;
  price: string | number;
  is_active: number | boolean;
  is_featured: number | boolean;
};

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

const NOTIFICATION_AUDIENCES = [
  "all",
  "students",
  "admins",
  "enrolled",
  "student",
] as const;

function normalizeAudience(value: string): Notification["audience"] {
  // Legacy rows stored the enrolled broadcast as plain "students".
  if (value === "enrolled" || value === "student" || value === "admins") {
    return value;
  }
  return value === "students" ? "students" : "all";
}

function mapNotificationRow(
  row: NotificationRow & { read_at?: Date | string | null },
): Notification {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    link: typeof row.link === "string" && row.link.trim() ? row.link.trim() : null,
    audience: normalizeAudience(row.audience),
    targetUid: row.target_uid ?? null,
    targetEmail: row.target_email ?? null,
    targetCourseId: row.target_course_id ?? null,
    origin: row.origin === "automatic" ? "automatic" : "manual",
    eventKey: row.event_key ?? null,
    isActive: Boolean(row.is_active),
    createdAt: toIso(row.created_at),
    // Present (non-null) only when joined with notification_reads for a
    // student that has read it; admin rows never join, so always false there.
    isRead: row.read_at !== undefined && row.read_at !== null,
  };
}

// ── Notifications ────────────────────────────────────────────────────────

async function ensureNotificationsTable(): Promise<void> {
  if (ensureNotificationsTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    audience ENUM('all','students','admins','enrolled','student') NOT NULL DEFAULT 'all',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(191) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // Older deployments: widen the audience enum + add specific-target columns.
  try {
    await exec(
      `ALTER TABLE notifications
         MODIFY audience ENUM('all','students','admins','enrolled','student') NOT NULL DEFAULT 'all',
         ADD COLUMN target_uid VARCHAR(128) NULL AFTER created_by,
         ADD COLUMN target_email VARCHAR(191) NULL AFTER target_uid`,
    );
  } catch {
    // Already migrated — safe to ignore.
  }
  // Notification Control separation: course-scoped enrolled targeting,
  // manual/automatic origin, and the once-only automatic event ledger key.
  // Each ALTER is independent so a partial migration still converges.
  const notificationControlColumns: Array<{ name: string; ddl: string }> = [
    { name: "target_course_id", ddl: "ADD COLUMN target_course_id VARCHAR(191) NULL AFTER target_email" },
    { name: "origin", ddl: "ADD COLUMN origin ENUM('manual','automatic') NOT NULL DEFAULT 'manual' AFTER target_course_id" },
    { name: "event_key", ddl: "ADD COLUMN event_key VARCHAR(191) NULL AFTER origin" },
  ];
  for (const column of notificationControlColumns) {
    try {
      await exec(`ALTER TABLE notifications ${column.ddl}`);
    } catch {
      // Column already exists — safe to ignore.
    }
  }
  // Click-through link (each ALTER independent so partial migrations converge).
  try {
    await exec(`ALTER TABLE notifications ADD COLUMN link VARCHAR(1024) NULL AFTER message`);
  } catch {
    // Column already exists — safe to ignore.
  }
  try {
    await exec(
      `ALTER TABLE notifications ADD UNIQUE KEY uq_notifications_event_key (event_key)`,
    );
  } catch {
    // Unique key already exists — safe to ignore. (MySQL treats NULLs as
    // distinct, so manual rows with NULL event_key never conflict.)
  }
  // Once-only ledger for automatic notifications: one row per fired event.
  // INSERT IGNORE on this table is the atomic duplicate guard — refreshes
  // and repeated reads can never resend the same event.
  await exec(`CREATE TABLE IF NOT EXISTS notification_events (
    event_key VARCHAR(191) NOT NULL PRIMARY KEY,
    notification_id VARCHAR(64) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notification_events_notification (notification_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // Per-student read state — persists across refreshes/devices. One row per
  // (notification, student). Never deleted except with the notification itself.
  await exec(`CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id VARCHAR(64) NOT NULL,
    student_uid VARCHAR(191) NOT NULL,
    read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, student_uid),
    KEY idx_notification_reads_student (student_uid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensureNotificationsTableReady = true;
}

/** Public ensure for the automatic event engine (same self-heal, no reads). */
export async function ensureNotificationTables(): Promise<void> {
  await ensureNotificationsTable();
}

export async function fetchNotifications(all = false): Promise<Notification[]> {
  try {
    await ensureNotificationsTable();
    const rows = await query<NotificationRow[]>(
      `SELECT * FROM notifications ${all ? "" : "WHERE is_active = 1"} ORDER BY created_at DESC LIMIT 200`,
    );
    return rows.map((row) => mapNotificationRow(row));
  } catch {
    return [];
  }
}

/**
 * Course-scoped enrolled visibility fragment.
 *
 * A student sees an "enrolled" notification ONLY when:
 *  - it targets a specific course AND the student is actively enrolled in
 *    THAT course (strict course isolation — never leaks across courses), or
 *  - it is a legacy broadcast (target_course_id IS NULL) AND the student
 *    has any active enrollment (backward compatible).
 *
 * The fragment consumes TWO `?` params (both = student uid).
 */
const ENROLLED_VISIBILITY = `(n.audience = 'enrolled' AND (
          (n.target_course_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM enrollments e
                WHERE e.student_uid = ? AND e.course_id = n.target_course_id
                  AND e.enrollment_status = 'active'))
          OR (n.target_course_id IS NULL AND EXISTS (
                SELECT 1 FROM enrollments e
                WHERE e.student_uid = ? AND e.enrollment_status = 'active'))
        ))`;

/**
 * Active notifications relevant to a specific student:
 *  - audience "all" (+ legacy "students") → everyone
 *  - audience "enrolled" + target_course_id → only students actively
 *    enrolled in THAT course (strict per-course isolation)
 *  - audience "enrolled" without a course → legacy: any active enrollment
 *  - audience "student" → only the targeted student
 *
 * Each item carries its persisted per-student read state (`isRead`) from
 * `notification_reads`, newest first. Targeting/delivery logic is unchanged.
 */
export async function fetchStudentNotifications(
  studentUid?: string,
): Promise<Notification[]> {
  try {
    await ensureNotificationsTable();
    if (!studentUid) {
      const rows = await query<NotificationRow[]>(
        `SELECT * FROM notifications
         WHERE is_active = 1 AND audience IN ('all','students')
         ORDER BY created_at DESC LIMIT 200`,
      );
      return rows.map((row) => mapNotificationRow(row));
    }
    const rows = await query<(NotificationRow & { read_at: Date | string | null })[]>(
      `SELECT n.*, r.read_at AS read_at FROM notifications n
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.student_uid = ?
       WHERE n.is_active = 1 AND (
         n.audience IN ('all','students')
         OR ${ENROLLED_VISIBILITY}
         OR (n.audience = 'student' AND n.target_uid = ?)
       )
       ORDER BY n.created_at DESC LIMIT 200`,
      [studentUid, studentUid, studentUid, studentUid],
    );
    return rows.map((row) => mapNotificationRow(row));
  } catch {
    return [];
  }
}

/**
 * Sanitize a notification click-through link. Allows relative in-app paths
 * ("/courses/...") and absolute https URLs. Anything else → null.
 */
export function sanitizeNotificationLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, 1024);
  if (!v) return null;
  if (v.startsWith("/")) return v;
  if (/^https:\/\//i.test(v)) return v;
  return null;
}

/** Persistently mark ONE notification as read for a student. */
export async function markNotificationRead(
  notificationId: string,
  studentUid: string,
): Promise<void> {
  const id = notificationId?.trim();
  const uid = studentUid?.trim();
  if (!id || !uid) return;
  await ensureNotificationsTable();
  await exec(
    `INSERT IGNORE INTO notification_reads (notification_id, student_uid)
     VALUES (?, ?)`,
    [id, uid],
  );
}

/**
 * Persistently mark EVERY notification currently visible to the student as
 * read (same targeting rules as the list — no other student's state touched,
 * no notification content changed).
 */
export async function markAllNotificationsRead(
  studentUid: string,
): Promise<void> {
  const uid = studentUid?.trim();
  if (!uid) return;
  await ensureNotificationsTable();
  await exec(
    `INSERT IGNORE INTO notification_reads (notification_id, student_uid)
     SELECT n.id, ? FROM notifications n
      WHERE n.is_active = 1 AND (
        n.audience IN ('all','students')
        OR ${ENROLLED_VISIBILITY}
        OR (n.audience = 'student' AND n.target_uid = ?)
      )`,
    [uid, uid, uid, uid],
  );
}

/** Count of visible-but-unread notifications for the header indicator. */
export async function fetchUnreadNotificationCount(
  studentUid: string,
): Promise<number> {
  const uid = studentUid?.trim();
  if (!uid) return 0;
  try {
    await ensureNotificationsTable();
    const rows = await query<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM notifications n
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.student_uid = ?
       WHERE n.is_active = 1 AND r.notification_id IS NULL AND (
         n.audience IN ('all','students')
         OR ${ENROLLED_VISIBILITY}
         OR (n.audience = 'student' AND n.target_uid = ?)
       )`,
      [uid, uid, uid, uid],
    );
    return Number(rows[0]?.n ?? 0) || 0;
  } catch {
    return 0;
  }
}

export async function saveNotification(
  input: Record<string, unknown>,
  adminUid: string,
): Promise<Notification[]> {
  await ensureNotificationsTable();
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (title.length < 2) throw new Error("Notification title is required.");
  if (message.length < 2) throw new Error("Notification message is required.");
  const rawAudience =
    typeof input.audience === "string" &&
    (NOTIFICATION_AUDIENCES as readonly string[]).includes(input.audience)
      ? input.audience
      : "all";
  // A specific-student notification requires a target.
  const targetEmail =
    typeof input.targetEmail === "string" && input.targetEmail.trim()
      ? input.targetEmail.trim().toLowerCase()
      : null;
  const targetUid =
    typeof input.targetUid === "string" && input.targetUid.trim()
      ? input.targetUid.trim()
      : null;
  const audience = (
    rawAudience === "student" && !targetEmail && !targetUid ? "all" : rawAudience
  ) as Notification["audience"];
  // Course-scoped enrolled targeting (Enrolled Students manual flow).
  // Only honored for audience "enrolled"; ignored for other audiences so
  // scopes can never be mixed.
  const targetCourseId =
    audience === "enrolled" &&
    typeof input.targetCourseId === "string" &&
    input.targetCourseId.trim()
      ? input.targetCourseId.trim().slice(0, 191)
      : null;
  // Manual vs automatic origin. The admin API never sends automatic —
  // automatic rows are written by the system event engine only.
  const origin: Notification["origin"] =
    input.origin === "automatic" ? "automatic" : "manual";
  const eventKey =
    typeof input.eventKey === "string" && input.eventKey.trim()
      ? input.eventKey.trim().slice(0, 191)
      : null;
  // Link is only overwritten when the caller explicitly sends the key —
  // silent callers (automatic templates, toggles) never wipe an existing link.
  const hasLinkKey = "link" in input;
  const link = hasLinkKey ? sanitizeNotificationLink(input.link) : null;
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : `ntf-${Date.now()}-${Math.floor(Math.random() * 1e6)
          .toString()
          .padStart(6, "0")}`;
  await exec(
    `INSERT INTO notifications (id, title, message, link, audience, is_active, created_by, target_uid, target_email, target_course_id, origin, event_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), message = VALUES(message),
       link = ${hasLinkKey ? "VALUES(link)" : "link"},
       audience = VALUES(audience), is_active = VALUES(is_active),
       target_uid = VALUES(target_uid), target_email = VALUES(target_email),
       target_course_id = VALUES(target_course_id)`,
    [
      id,
      title,
      message,
      link,
      audience,
      input.isActive === false ? 0 : 1,
      adminUid,
      targetUid,
      targetEmail,
      targetCourseId,
      origin,
      eventKey,
    ],
  );
  return fetchNotifications(true);
}

/** Enable / disable a notification without touching its content. */
export async function setNotificationActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const clean = id?.trim();
  if (!clean) return;
  await ensureNotificationsTable();
  await exec(`UPDATE notifications SET is_active = ? WHERE id = ?`, [
    isActive ? 1 : 0,
    clean,
  ]);
}

export async function deleteNotification(id: string): Promise<void> {
  await ensureNotificationsTable();
  await exec(`DELETE FROM notification_reads WHERE notification_id = ?`, [id]);
  await exec(`DELETE FROM notifications WHERE id = ?`, [id]);
}

// ── Jerseys ──────────────────────────────────────────────────────────────

async function ensureJerseysTable(): Promise<void> {
  if (ensureJerseysTableReady) return;
  await exec(`CREATE TABLE IF NOT EXISTS jerseys (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    note TEXT NULL,
    image_url VARCHAR(1024) NULL,
    link VARCHAR(1024) NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  try {
    await exec(`ALTER TABLE jerseys ADD COLUMN link VARCHAR(1024) NULL AFTER image_url`);
  } catch {
    // Column already exists — safe to ignore.
  }
  ensureJerseysTableReady = true;
  try {
    await exec(`ALTER TABLE jerseys ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active`);
  } catch {
    // Column already exists — safe to ignore.
  }
  try {
    await exec(`ALTER TABLE jerseys ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER is_featured`);
  } catch {
    // Column already exists — safe to ignore.
  }
}

export async function fetchActiveJerseys(): Promise<JerseyItem[]> {
  const jerseys = await fetchJerseys();
  return jerseys.filter((jersey) => jersey.isActive && jersey.image);
}

export async function fetchFeaturedJerseys(): Promise<JerseyItem[]> {
  const jerseys = await fetchActiveJerseys();
  return jerseys.filter((jersey) => jersey.featured);
}

export async function fetchJerseys(): Promise<JerseyItem[]> {
  try {
    await ensureJerseysTable();
    const rows = await query<JerseyRow[]>(
      `SELECT * FROM jerseys ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      note: row.note,
      image: row.image_url,
      link: row.link ?? null,
      price: Number(row.price) || 0,
      isActive: Boolean(row.is_active),
      featured: Boolean(row.is_featured),
    }));
  } catch {
    return [];
  }
}

export async function saveJersey(
  input: Record<string, unknown>,
): Promise<JerseyItem[]> {
  await ensureJerseysTable();
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 2) throw new Error("Jersey name is required.");
  const id =
    typeof input.id === "string" && input.id.trim()
      ? input.id.trim()
      : `jersey-${Date.now()}`;
  const nameValue = name;
  const noteValue =
    typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;
  const imageValue =
    typeof input.image === "string" && input.image.trim() ? input.image.trim() : null;
  const linkValue =
    typeof input.link === "string" && input.link.trim() ? input.link.trim() : null;
  const priceValue = Math.max(0, Number(input.price) || 0);
  const isActiveValue = input.isActive === false ? 0 : 1;
  const featuredValue = input.featured === true ? 1 : 0;
  const existing = await query<{ id: string }[]>(
    `SELECT id FROM jerseys WHERE id = ? LIMIT 1`,
    [id],
  );
  if (existing.length === 0) {
    // New uploads append at the end of the live slider order.
    const maxRow = await query<{ m: number | null }[]>(
      `SELECT MAX(sort_order) AS m FROM jerseys`,
    );
    const nextOrder = (maxRow[0]?.m ?? -1) + 1;
    await exec(
      `INSERT INTO jerseys (id, name, note, image_url, link, price, is_active, is_featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, nameValue, noteValue, imageValue, linkValue, priceValue, isActiveValue, featuredValue, nextOrder],
    );
  } else {
    // Edits never disturb the admin-arranged slider order.
    await exec(
      `UPDATE jerseys SET name = ?, note = ?, image_url = ?, link = ?, price = ?,
        is_active = ?, is_featured = ? WHERE id = ?`,
      [nameValue, noteValue, imageValue, linkValue, priceValue, isActiveValue, featuredValue, id],
    );
  }
  return fetchJerseys();
}

/** Persist the admin-arranged slider order (first id = first slide). */
export async function reorderJerseys(orderedIds: string[]): Promise<JerseyItem[]> {
  await ensureJerseysTable();
  const ids = orderedIds.filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) throw new Error("No jersey order provided.");
  for (let index = 0; index < ids.length; index += 1) {
    await exec(`UPDATE jerseys SET sort_order = ? WHERE id = ?`, [index, ids[index]]);
  }
  return fetchJerseys();
}

export async function deleteJersey(id: string): Promise<void> {
  await ensureJerseysTable();
  await exec(`DELETE FROM jerseys WHERE id = ?`, [id]);
}

// ── Media library ────────────────────────────────────────────────────────

export type MediaItem = {
  id: string;
  fileName: string;
  directory: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
};

export async function fetchMediaLibrary(limit = 200): Promise<MediaItem[]> {
  try {
    const rows = await query<{
      id: string;
      file_name: string;
      directory: string;
      mime_type: string;
      size: number;
      created_at: Date | string;
    }[]>(
      `SELECT id, file_name, directory, mime_type, size, created_at
       FROM uploads ORDER BY created_at DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
    );
    return rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      directory: row.directory,
      mimeType: row.mime_type,
      size: row.size ?? 0,
      url: `/api/files/${row.id}`,
      createdAt: toIso(row.created_at),
    }));
  } catch {
    return [];
  }
}

export async function deleteMediaItem(id: string): Promise<boolean> {
  const result = await exec(`DELETE FROM uploads WHERE id = ?`, [id]);
  return (result.affectedRows ?? 0) > 0;
}

/** Total uploads count and bytes — used by System → Storage. */
export async function fetchUploadStats(): Promise<{ files: number; bytes: number }> {
  try {
    const rows = await query<{ files: number; bytes: string | number | null }[]>(
      `SELECT COUNT(*) AS files, SUM(size) AS bytes FROM uploads`,
    );
    return {
      files: rows[0]?.files ?? 0,
      bytes: Number(rows[0]?.bytes ?? 0) || 0,
    };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/**
 * Columns that may hold a managed upload reference ("/api/files/<id>" or a
 * storage path). Used to detect unused files in the Media Library.
 */
const MEDIA_REFERENCE_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "banners", column: "url" },
  { table: "banners", column: "storage_path" },
  { table: "logos", column: "url" },
  { table: "logos", column: "storage_path" },
  { table: "course_categories", column: "image_url" },
  { table: "course_categories", column: "image_storage_path" },
  { table: "catalog_courses", column: "image_url" },
  { table: "catalog_courses", column: "teacher_photo_url" },
  { table: "admin_courses", column: "image_url" },
  { table: "admin_courses", column: "image_storage_path" },
  { table: "homepage_courses", column: "image_url" },
  { table: "students", column: "profile_picture_url" },
  { table: "admins", column: "photo_url" },
  { table: "jerseys", column: "image_url" },
  { table: "mentors", column: "photo_url" },
  { table: "mentors", column: "photo_storage_path" },
  { table: "reviews", column: "photo_url" },
  { table: "reviews", column: "photo_storage_path" },
  { table: "seo_settings", column: "og_image_url" },
  { table: "hero_settings", column: "background_url" },
];

/** All upload ids referenced anywhere in the content tables. */
async function fetchReferencedUploadIds(): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const { table, column } of MEDIA_REFERENCE_COLUMNS) {
    try {
      const rows = await query<{ value: string | null }[]>(
        `SELECT ${column} AS value FROM ${table}`,
      );
      for (const row of rows) {
        const value = row.value;
        if (typeof value !== "string") continue;
        // Match "/api/files/<uuid>" anywhere in the stored value.
        const matches = value.matchAll(/\/api\/files\/([0-9a-f-]{16,64})/gi);
        for (const match of matches) {
          if (match[1]) referenced.add(match[1].toLowerCase());
        }
      }
    } catch {
      // Table/column may not exist on older databases — skip it.
    }
  }
  return referenced;
}

/**
 * Uploads not referenced by any content table — safe-to-delete candidates.
 */
export async function findUnusedUploads(): Promise<MediaItem[]> {
  const [media, referenced] = await Promise.all([
    fetchMediaLibrary(500),
    fetchReferencedUploadIds(),
  ]);
  return media.filter((item) => !referenced.has(item.id.toLowerCase()));
}

/** Delete every unreferenced upload. Returns how many were removed. */
export async function deleteUnusedMedia(): Promise<number> {
  const unused = await findUnusedUploads();
  let count = 0;
  for (const item of unused) {
    try {
      const deleted = await removeUploadRow(item.id);
      if (deleted) count += 1;
    } catch {
      // Skip failures and continue.
    }
  }
  return count;
}

async function removeUploadRow(id: string): Promise<boolean> {
  const result = await exec(`DELETE FROM uploads WHERE id = ?`, [id]);
  return (result.affectedRows ?? 0) > 0;
}
