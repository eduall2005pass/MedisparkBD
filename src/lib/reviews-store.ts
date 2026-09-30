import { exec, query, ensureColumn } from "@/lib/mysql";
import { saveFile, removeFile } from "@/lib/storage";

let ensureReviewsTableReady = false;
export const REVIEW_PHOTO_DIR = "review-photos";
export const MAX_REVIEW_PHOTO_SIZE = 5 * 1024 * 1024;
export const ALLOWED_REVIEW_PHOTO_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
] as const;

export type ReviewRecord = {
  id: string;
  studentUid: string | null;
  studentName: string;
  studentAvatar: string | null;
  courseName: string;
  batchLabel: string;
  rating: number;
  text: string;
  isPublished: boolean;
  createdAt: number;
};

type ReviewRow = {
  id: string;
  student_uid: string | null;
  student_name: string;
  photo_url: string | null;
  photo_storage_path: string | null;
  course_name: string | null;
  batch_label: string | null;
  rating: number;
  review_text: string;
  is_published: number | boolean;
  created_at: Date | string;
};

async function ensureReviewsTable(): Promise<void> {
  if (ensureReviewsTableReady) return;
  await exec(
    `CREATE TABLE IF NOT EXISTS reviews (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      student_uid VARCHAR(191) NULL,
      student_name VARCHAR(255) NOT NULL,
      photo_url VARCHAR(1024) NULL,
      photo_storage_path VARCHAR(1024) NULL,
      course_name VARCHAR(255) NULL,
      batch_label VARCHAR(100) NULL,
      rating TINYINT UNSIGNED NOT NULL DEFAULT 5,
      review_text TEXT NOT NULL,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY reviews_student_uid_index (student_uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  // Self-migrate existing deployments that predate student-owned reviews.
  await ensureColumn("reviews", "student_uid", "`student_uid` VARCHAR(191) NULL");
  ensureReviewsTableReady = true;
}

/** Rating first (5★ → 1★), then newest within the same rating. */
const REVIEW_ORDER_CLAUSE = "ORDER BY rating DESC, created_at DESC, id DESC";

function rowToReview(row: ReviewRow): ReviewRecord {
  return {
    id: row.id,
    studentUid: row.student_uid ?? null,
    studentName: row.student_name,
    studentAvatar: row.photo_url ?? null,
    courseName: row.course_name ?? "",
    batchLabel: row.batch_label ?? "",
    rating: Math.min(5, Math.max(1, Number(row.rating) || 5)),
    text: row.review_text,
    isPublished: Boolean(row.is_published),
    createdAt: Date.parse(
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    ),
  };
}

/** Published reviews only, ordered 5★→1★ — used by the live homepage. */
export async function fetchPublishedReviewRecords(
  limit = 100,
  offset = 0,
): Promise<ReviewRecord[]> {
  try {
    await ensureReviewsTable();
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
    const safeOffset = Math.max(Math.floor(offset), 0);
    const rows = await query<ReviewRow[]>(
      `SELECT id, student_uid, student_name, photo_url, photo_storage_path, course_name, batch_label,
              rating, review_text, is_published, created_at
       FROM reviews WHERE is_published = 1 ${REVIEW_ORDER_CLAUSE} LIMIT ? OFFSET ?`,
      [safeLimit, safeOffset],
    );
    return rows.map(rowToReview);
  } catch {
    return [];
  }
}

/** All reviews (including hidden), ordered 5★→1★ — used by the Admin Panel. */
export async function fetchAllReviewRecords(
  limit = 200,
  offset = 0,
): Promise<ReviewRecord[]> {
  try {
    await ensureReviewsTable();
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
    const safeOffset = Math.max(Math.floor(offset), 0);
    const rows = await query<ReviewRow[]>(
      `SELECT id, student_uid, student_name, photo_url, photo_storage_path, course_name, batch_label,
              rating, review_text, is_published, created_at
       FROM reviews ${REVIEW_ORDER_CLAUSE} LIMIT ? OFFSET ?`,
      [safeLimit, safeOffset],
    );
    return rows.map(rowToReview);
  } catch {
    return [];
  }
}

/** A single student's own review (if any) — used for edit-own-review flows. */
export async function fetchStudentReview(
  studentUid: string,
): Promise<ReviewRecord | null> {
  if (!studentUid) return null;
  try {
    await ensureReviewsTable();
    const rows = await query<ReviewRow[]>(
      `SELECT id, student_uid, student_name, photo_url, photo_storage_path, course_name, batch_label,
              rating, review_text, is_published, created_at
       FROM reviews WHERE student_uid = ? ORDER BY created_at DESC LIMIT 1`,
      [studentUid],
    );
    return rows[0] ? rowToReview(rows[0]) : null;
  } catch {
    return null;
  }
}

async function deletePhotoFile(storagePath: string | null | undefined): Promise<void> {
  if (typeof storagePath !== "string" || storagePath.length === 0) return;
  const isManaged =
    storagePath.startsWith(REVIEW_PHOTO_DIR) ||
    storagePath.includes(REVIEW_PHOTO_DIR) ||
    storagePath.includes("/medifiles/");
  if (!isManaged) return;
  try {
    await removeFile(storagePath);
  } catch {
    // Best-effort cleanup.
  }
}

export type ReviewSaveInput = {
  id?: string;
  studentUid?: string | null;
  studentName: string;
  text: string;
  rating: number;
  courseName?: string | null;
  batchLabel?: string | null;
  isPublished?: boolean;
  photoFile?: File | null;
};

function generateReviewId(): string {
  return `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveReviewRecord(
  input: ReviewSaveInput,
): Promise<ReviewRecord[]> {
  await ensureReviewsTable();

  const id = input.id ?? generateReviewId();
  const name = input.studentName.trim();
  const text = input.text.trim();
  const rating = Math.min(5, Math.max(1, Math.round(input.rating) || 5));

  if (name.length === 0 || name.length > 255) {
    throw new Error("Student name is required and must be under 255 characters.");
  }
  if (text.length === 0 || text.length > 2000) {
    throw new Error("Review text is required and must be under 2000 characters.");
  }

  // Keep existing photo + sort order + ownership unless this is a new row.
  const currentRows = await query<
    { photo_url: string | null; photo_storage_path: string | null; sort_order: number; student_uid: string | null }[]
  >("SELECT photo_url, photo_storage_path, sort_order, student_uid FROM reviews WHERE id = ? LIMIT 1", [id]);
  const existing = currentRows[0] ?? null;
  // `undefined` = not provided (e.g. admin edit) → preserve existing owner.
  // Explicit string (or null/empty) = set/clear the owner.
  const ownerUid =
    input.studentUid === undefined
      ? (existing?.student_uid ?? null)
      : input.studentUid?.trim() || null;
  let finalPhotoUrl = existing?.photo_url ?? null;
  let finalPhotoPath = existing?.photo_storage_path ?? null;
  let previousPhotoPath: string | null = null;

  if (input.photoFile) {
    const extension = input.photoFile.name.includes(".")
      ? `.${input.photoFile.name.split(".").pop()?.toLowerCase() ?? ""}`
      : ".png";
    if (
      !(ALLOWED_REVIEW_PHOTO_EXTENSIONS as readonly string[]).includes(extension)
    ) {
      throw new Error("Unsupported photo type. Use PNG, JPG, WebP or GIF.");
    }
    if (input.photoFile.size > MAX_REVIEW_PHOTO_SIZE) {
      throw new Error("Photo must be 5 MB or smaller.");
    }
    const fileName = `${id}-${Date.now()}${extension}`;
    finalPhotoUrl = await saveFile(
      REVIEW_PHOTO_DIR,
      fileName,
      await input.photoFile.arrayBuffer(),
    );
    previousPhotoPath = finalPhotoPath;
    finalPhotoPath = finalPhotoUrl;
  }

  const sortOrder =
    existing?.sort_order ??
    (
      await query<{ next_order: number }[]>(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM reviews",
      )
    )[0]?.next_order ??
    1;

  await exec(
    `INSERT INTO reviews
       (id, student_uid, student_name, photo_url, photo_storage_path, course_name, batch_label,
        rating, review_text, is_published, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       student_uid = VALUES(student_uid),
       student_name = VALUES(student_name),
       photo_url = VALUES(photo_url),
       photo_storage_path = VALUES(photo_storage_path),
       course_name = VALUES(course_name),
       batch_label = VALUES(batch_label),
       rating = VALUES(rating),
       review_text = VALUES(review_text),
       is_published = VALUES(is_published)`,
    [
      id,
      ownerUid,
      name,
      finalPhotoUrl,
      finalPhotoPath,
      input.courseName?.trim() || null,
      input.batchLabel?.trim() || null,
      rating,
      text,
      input.isPublished === true ? 1 : 0,
      sortOrder,
    ],
  );

  if (previousPhotoPath && previousPhotoPath !== finalPhotoPath) {
    await deletePhotoFile(previousPhotoPath);
  }

  return fetchAllReviewRecords();
}

export type StudentReviewSaveInput = {
  studentUid: string;
  studentName: string;
  studentAvatar?: string | null;
  text: string;
  rating: number;
  courseName?: string | null;
  batchLabel?: string | null;
};

/**
 * Student self-submission: exactly one review per account. A returning
 * student updates their own review (edit-own only — the row is always
 * scoped by student_uid, so nobody can touch another student's review).
 * Student reviews go live immediately; admins can still hide/delete them.
 */
export async function saveStudentReview(
  input: StudentReviewSaveInput,
): Promise<ReviewRecord> {
  await ensureReviewsTable();
  const uid = input.studentUid.trim();
  if (!uid) throw new Error("Sign in to submit a review.");
  const name = input.studentName.trim();
  const text = input.text.trim();
  const rating = Math.min(5, Math.max(1, Math.round(input.rating) || 5));
  if (name.length === 0 || name.length > 255) {
    throw new Error("Student name is required and must be under 255 characters.");
  }
  if (text.length === 0 || text.length > 2000) {
    throw new Error("Review text is required and must be under 2000 characters.");
  }
  if (text.length < 10) {
    throw new Error("Please write a little more (at least 10 characters).");
  }

  const existing = await query<{ id: string; updated_at: Date | string }[]>(
    "SELECT id, updated_at FROM reviews WHERE student_uid = ? ORDER BY created_at DESC LIMIT 1",
    [uid],
    { cache: false },
  );
  if (existing[0]?.updated_at) {
    const lastEdit = new Date(String(existing[0].updated_at)).getTime();
    if (!Number.isNaN(lastEdit) && Date.now() - lastEdit < 60_000) {
      throw new Error("You just edited your review — please wait a minute before editing again.");
    }
  }
  const id = existing[0]?.id ?? generateReviewId();
  const nextOrder =
    (
      await query<{ next_order: number }[]>(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM reviews",
      )
    )[0]?.next_order ?? 1;

  await exec(
    `INSERT INTO reviews
       (id, student_uid, student_name, photo_url, photo_storage_path, course_name, batch_label,
        rating, review_text, is_published, sort_order)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       student_name = VALUES(student_name),
       photo_url = VALUES(photo_url),
       course_name = VALUES(course_name),
       batch_label = VALUES(batch_label),
       rating = VALUES(rating),
       review_text = VALUES(review_text),
       is_published = 1`,
    [
      id,
      uid,
      name,
      input.studentAvatar?.trim() || null,
      input.courseName?.trim() || null,
      input.batchLabel?.trim() || null,
      rating,
      text,
      nextOrder,
    ],
  );

  const saved = await fetchStudentReview(uid);
  if (!saved) throw new Error("Failed to save your review. Please try again.");
  return saved;
}

export async function setReviewPublished(
  id: string,
  published: boolean,
): Promise<ReviewRecord[]> {
  await ensureReviewsTable();
  await exec("UPDATE reviews SET is_published = ? WHERE id = ?", [
    published ? 1 : 0,
    id,
  ]);
  return fetchAllReviewRecords();
}

export async function reorderReviews(orderedIds: string[]): Promise<ReviewRecord[]> {
  await ensureReviewsTable();
  for (let index = 0; index < orderedIds.length; index += 1) {
    await exec("UPDATE reviews SET sort_order = ? WHERE id = ?", [
      index + 1,
      orderedIds[index],
    ]);
  }
  return fetchAllReviewRecords();
}

export async function deleteReviewRecord(id: string): Promise<ReviewRecord[]> {
  try {
    const rows = await query<{ photo_storage_path: string | null }[]>(
      "SELECT photo_storage_path FROM reviews WHERE id = ? LIMIT 1",
      [id],
    );
    await exec("DELETE FROM reviews WHERE id = ?", [id]);
    if (rows[0]?.photo_storage_path) {
      await deletePhotoFile(rows[0].photo_storage_path);
    }
  } catch {
    // Best effort — still return the remaining list.
  }
  return fetchAllReviewRecords();
}
