import type { User } from "firebase/auth";
import type { Course } from "./courses";
import { getPayableFee } from "./courses";

export type CourseKind = "free" | "paid";

export type EnrollmentStatus =
  | "pending"
  | "active"
  | "cancelled"
  | "completed";

export type Enrollment = {
  studentUid: string;
  courseId: string;
  courseName: string;
  courseType: "Academic" | "Admission";
  courseKind: CourseKind;
  fee: number;
  enrollmentStatus: EnrollmentStatus;
  enrollmentDate?: unknown;
  updatedAt?: unknown;
  /** Course-level Q&A access for this enrolled course. */
  qaAccess?: boolean;
};

export function getCourseKind(course: Course): CourseKind {
  // Payable Amount (discount when set, else fee) is the source of truth:
  // 0 → free, > 0 → paid.
  return getPayableFee(course) > 0 ? "paid" : "free";
}

export function isActiveEnrollment(enrollment: Enrollment): boolean {
  return enrollment.enrollmentStatus === "active";
}

async function authHeaders(user: User): Promise<Record<string, string>> {
  const token = await user.getIdToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchEnrollments(user: User): Promise<Enrollment[]> {
  // Throws on network/non-ok so callers can distinguish failure (keep prev)
  // from a genuine empty list (valid []).
  const response = await fetch("/api/enrollments", {
    headers: await authHeaders(user),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`enrollments fetch failed: ${response.status}`);
  const data = (await response.json()) as { enrollments?: unknown };
  return Array.isArray(data.enrollments) ? (data.enrollments as Enrollment[]) : [];
}

export async function getEnrollment(
  user: User,
  courseId: string,
): Promise<Enrollment | null> {
  const enrollments = await fetchEnrollments(user);
  return (
    enrollments.find((enrollment) => enrollment.courseId === courseId) ?? null
  );
}

/** Payment proof submitted with a paid-course enrollment (Step 4). */
export type EnrollmentPayment = {
  transactionId: string;
  senderMobile: string;
  paymentMethod: "bkash" | "nagad";
};

/**
 * Creates an enrollment record via the API. Free courses become active
 * immediately; paid courses require payment proof and start as a
 * pending-validation application until an admin approves it.
 */
export async function enrollInCourse(
  course: Course,
  user: User,
  couponCode?: string | null,
  payment?: EnrollmentPayment,
): Promise<Enrollment> {
  const response = await fetch("/api/enrollments", {
    method: "POST",
    headers: await authHeaders(user),
    body: JSON.stringify({
      courseId: course.slug,
      courseName: course.name,
      courseType: course.category,
      courseKind: getCourseKind(course),
      fee: getPayableFee(course),
      ...(couponCode ? { couponCode } : {}),
      ...(payment ?? {}),
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    enrollment?: Enrollment;
    error?: string;
  } | null;
  if (!response.ok || !data?.enrollment) {
    throw new Error(data?.error ?? "Could not complete the enrollment.");
  }
  return data.enrollment;
}