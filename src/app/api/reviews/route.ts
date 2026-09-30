import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/admin";
import { getFirebaseUser } from "@/lib/auth-api";
import { query } from "@/lib/mysql";
import {
  fetchAllReviewRecords,
  fetchPublishedReviewRecords,
  saveReviewRecord,
  saveStudentReview,
  setReviewPublished,
  reorderReviews,
  deleteReviewRecord,
} from "@/lib/reviews-store";

// Public content: edge-cached for fast loads (60s revalidation).
export const revalidate = 300;

export async function GET(request: NextRequest) {
  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get("limit")) || 100, 1),
    200,
  );
  const offset = Math.max(
    Number(request.nextUrl.searchParams.get("offset")) || 0,
    0,
  );
  const reviews = await fetchPublishedReviewRecords(limit, offset);
  return NextResponse.json({ reviews });
}

/**
 * Create or update a review.
 * - Admin Panel (multipart form + manageContent): full control, as before.
 * - Homepage form (JSON { rating, text }): creates/updates ONLY the caller's
 *   own review using their real account info — including admins submitting
 *   as students, since the homepage always sends JSON.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const admin = await requirePermission(request, "manageContent");
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    return handleAdminPost(request);
  }
  return handleStudentPost(request);
}

/** Admin create/update (multipart — supports optional photo upload). */
async function handleAdminPost(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form submission. Please try again." },
      { status: 400 },
    );
  }
  const rawId = formData.get("id");
  const studentName = formData.get("student_name");
  const text = formData.get("text");
  const ratingRaw = formData.get("rating");
  const courseName = formData.get("course_name");
  const batchLabel = formData.get("batch_label");
  const publishedRaw = formData.get("is_published");
  const photo = formData.get("photo");

  if (typeof studentName !== "string" || studentName.trim().length === 0) {
    return NextResponse.json({ error: "Student name is required." }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Review text is required." }, { status: 400 });
  }
  if (photo !== null && !(photo instanceof File)) {
    return NextResponse.json({ error: "Invalid photo." }, { status: 400 });
  }

  try {
    const reviews = await saveReviewRecord({
      id: typeof rawId === "string" && rawId.trim().length > 0 ? rawId.trim() : undefined,
      studentName,
      text,
      rating: Number(ratingRaw) || 5,
      courseName: typeof courseName === "string" ? courseName : null,
      batchLabel: typeof batchLabel === "string" ? batchLabel : null,
      isPublished: publishedRaw === "true" || publishedRaw === "1",
      photoFile: photo instanceof File && photo.size > 0 ? photo : null,
    });
    return NextResponse.json({ reviews });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save the review.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

type StudentRow = {
  full_name: string | null;
  profile_picture_url: string | null;
  hsc_batch: string | null;
};

/** Student self-submission — creates/updates only the caller's own review. */
async function handleStudentPost(request: NextRequest) {
  const user = await getFirebaseUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to submit a review." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    rating?: unknown;
    text?: unknown;
  } | null;
  const rating = Math.round(Number(body?.rating) || 0);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (rating < 1 || rating > 5) {
    return NextResponse.json(
      { error: "Please select a star rating from 1 to 5." },
      { status: 400 },
    );
  }
  if (!text) {
    return NextResponse.json(
      { error: "Please write your review before submitting." },
      { status: 400 },
    );
  }
  if (text.length < 10) {
    return NextResponse.json(
      { error: "Please write a little more (at least 10 characters)." },
      { status: 400 },
    );
  }
  if (text.length > 2000) {
    return NextResponse.json(
      { error: "Review is too long (max 2000 characters)." },
      { status: 400 },
    );
  }

  // Real account info — never trust client-supplied name/photo.
  let student: StudentRow | null = null;
  try {
    const rows = await query<StudentRow[]>(
      "SELECT full_name, profile_picture_url, hsc_batch FROM students WHERE uid = ? LIMIT 1",
      [user.uid],
    );
    student = rows[0] ?? null;
  } catch {
    return NextResponse.json(
      { error: "Could not verify your student account. Please try again." },
      { status: 500 },
    );
  }
  if (!student?.full_name) {
    return NextResponse.json(
      { error: "Complete your student registration before submitting a review." },
      { status: 403 },
    );
  }

  // Course context from the student's latest active enrollment (if any).
  let courseName: string | null = null;
  try {
    const enrollments = await query<{ course_name: string | null }[]>(
      `SELECT course_name FROM enrollments
        WHERE student_uid = ? AND enrollment_status = 'active'
        ORDER BY enrollment_date DESC LIMIT 1`,
      [user.uid],
    );
    courseName = enrollments[0]?.course_name ?? null;
  } catch {
    courseName = null;
  }

  try {
    const review = await saveStudentReview({
      studentUid: user.uid,
      studentName: student.full_name,
      studentAvatar: student.profile_picture_url,
      text,
      rating,
      courseName,
      batchLabel: student.hsc_batch ? `${student.hsc_batch} Batch` : null,
    });
    return NextResponse.json({ review });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save your review.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Approve/hide reviews and/or change display order. */
export async function PUT(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    order?: unknown;
    updates?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    let reviews = await fetchAllReviewRecords();

    if (Array.isArray(body.updates)) {
      for (const raw of body.updates) {
        const entry = raw as Record<string, unknown>;
        if (typeof entry.id !== "string" || entry.id.length === 0) continue;
        if (typeof entry.isPublished === "boolean") {
          reviews = await setReviewPublished(entry.id, entry.isPublished);
        }
      }
    }

    if (
      Array.isArray(body.order) &&
      body.order.every((item) => typeof item === "string")
    ) {
      reviews = await reorderReviews(body.order as string[]);
    }

    return NextResponse.json({ reviews });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update the reviews.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requirePermission(request, "manageContent");
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ error: "Missing review id." }, { status: 400 });
  }
  const reviews = await deleteReviewRecord(body.id);
  return NextResponse.json({ reviews });
}
