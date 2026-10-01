"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AccessLoading, AccessMessage } from "@/components/auth/AccessGuard";
import { useAdminToast } from "@/components/admin/AdminToastProvider";
import AdminConfirmDialog from "@/components/admin/AdminConfirmDialog";
import {
  useAdminGate,
  hasAdminPermission,
  cardClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/components/admin/admin-ui";
import type {
  AdminStudent,
  StudentEnrollmentInfo,
  StudentExamResult,
  StudentProgressSummary,
} from "@/lib/students-admin";
import StudentContactButtons from "@/components/admin/StudentContactButtons";

function formatDate(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFee(value: number): string {
  if (value <= 0) return "Free";
  return `৳${value.toLocaleString()}`;
}

export default function StudentDetailsPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const gate = useAdminGate();
  const allowed = hasAdminPermission(gate, "manageStudents");
  const { user, authLoading } = useAuth();
  const toast = useAdminToast();

  const [student, setStudent] = useState<AdminStudent | null>(null);
  const [enrollments, setEnrollments] = useState<StudentEnrollmentInfo[]>([]);
  const [examResults, setExamResults] = useState<StudentExamResult[]>([]);
  const [progress, setProgress] = useState<StudentProgressSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Activation confirm
  const [confirmTarget, setConfirmTarget] = useState<{ active: boolean } | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async (uid: string) => {
    if (!user) return;
    setLoading(true);
    setLoadError(false);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/students?uid=${encodeURIComponent(uid)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as {
        student?: AdminStudent;
        enrollments?: StudentEnrollmentInfo[];
        examResults?: StudentExamResult[];
        progress?: StudentProgressSummary[];
      };
      if (data.student) {
        setStudent(data.student);
        setEnrollments(data.enrollments ?? []);
        setExamResults(data.examResults ?? []);
        setProgress(data.progress ?? []);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user || !gate.ready) return;
    params.then((p) => {
      const uid = decodeURIComponent(p.uid);
      void load(uid);
    });
  }, [authLoading, user, gate.ready, params, load]);

  async function handleToggleActive(active: boolean) {
    if (!user || !student) return;
    setToggling(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/admin/students", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid: student.uid, isActive: active }),
      });
      const data = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        toast.showToast("error", data.error ?? "Failed to update the account.");
        return;
      }
      toast.showToast("success", data.message ?? "Account updated.");
      setStudent((prev) => (prev ? { ...prev, isActive: active } : prev));
    } catch {
      toast.showToast("error", "Failed to update the account.");
    } finally {
      setToggling(false);
      setConfirmTarget(null);
    }
  }

  if (!gate.ready) return <AccessLoading label="Loading Student Details…" />;
  if (!allowed) {
    return (
      <AccessMessage
        title="Student Details — Student Control access required"
        message="Your role does not include permission to view student details."
        actionLabel="Back to Students"
        actionHref="/admin/students/all"
      />
    );
  }

  if (loading) return <AccessLoading label="Loading student details…" />;

  if (loadError || !student) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className={`${cardClass} mt-6 p-8 text-center`}>
          <p className="text-sm font-bold text-red-500">Student not found.</p>
          <p className="mt-1 text-xs text-slate-500">The student may have been removed or the link is invalid.</p>
        </div>
      </section>
    );
  }

  const totalEnrolledFee = enrollments.reduce((sum, e) => sum + e.fee, 0);
  const activeEnrollments = enrollments.filter((e) => e.status === "active");
  const paidEnrollments = enrollments.filter((e) => e.courseKind === "paid");

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* Profile header */}
      <div className={`${cardClass} mt-6 p-6`}>
        <div className="flex flex-wrap items-center gap-4">
          {/* Profile photo */}
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 border-[#dbeafe] bg-[#f1f5f9] shadow-md admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547]">
            {student.profilePictureUrl ? (
              <Image
                src={student.profilePictureUrl}
                alt={student.fullName}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl font-extrabold text-slate-400">
                {student.fullName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          {/* Name + status */}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold text-[#0b1e3a] admin-dark:text-white">
              {student.fullName}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">{student.studentId}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${student.isActive ? "bg-emerald-500/10 text-emerald-600 admin-dark:text-emerald-400" : "bg-red-500/10 text-red-500 admin-dark:text-red-400"}`}>
                {student.isActive ? "Active" : "Deactivated"}
              </span>
              <span className="rounded-full bg-[#dbeafe] px-3 py-1 text-xs font-bold text-[#1a3a78] admin-dark:bg-[#1e3a65] admin-dark:text-[#93c5fd]">
                {student.hscBatch || "N/A"} Batch
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmTarget({ active: !student.isActive })}
              disabled={toggling}
              className={`rounded-xl px-4 py-2 text-xs font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60 ${
                student.isActive
                  ? "bg-red-600 shadow-red-900/30 hover:bg-red-700"
                  : "bg-emerald-600 shadow-emerald-900/30 hover:bg-emerald-700"
              }`}
            >
              {toggling ? "Updating…" : student.isActive ? "Deactivate" : "Activate"}
            </button>
          </div>
        </div>
      </div>

      {/* Personal Information */}
      <div className={`${cardClass} mt-4 p-5`}>
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Personal Information</h3>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <InfoRow label="Full Name" value={student.fullName} />
          <InfoRow label="Student ID" value={student.studentId} />
          <InfoRow label="Email" value={student.email || "—"} />
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">Phone</dt>
            <dd className="flex items-center gap-2 font-mono text-sm text-slate-700 admin-dark:text-zinc-200">
              {student.contactNumber || "—"}
              <StudentContactButtons phone={student.contactNumber} size="sm" />
            </dd>
          </div>
          <InfoRow label="Gender" value={student.gender || "—"} />
          <InfoRow label="Institution" value={student.institution || "—"} />
          <InfoRow label="HSC Batch" value={student.hscBatch || "—"} />
          <InfoRow label="Student Level" value={student.studentLevel || "—"} />
          <InfoRow label="Sign-in Method" value={student.provider} />
          <InfoRow label="Registration Date" value={formatDate(student.createdAt)} />
          <InfoRow label="Facebook" value={student.facebookUrl || "—"} />
        </dl>
      </div>

      {/* Enrollment Summary */}
      <div className={`${cardClass} mt-4 p-5`}>
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Enrollment Summary</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Enrollments" value={String(enrollments.length)} color="text-[#1a3a78] admin-dark:text-[#93c5fd]" />
          <StatCard label="Active Courses" value={String(activeEnrollments.length)} color="text-emerald-600 admin-dark:text-emerald-400" />
          <StatCard label="Paid Courses" value={String(paidEnrollments.length)} color="text-amber-600 admin-dark:text-amber-400" />
          <StatCard label="Total Spent" value={formatFee(totalEnrolledFee)} color="text-[#1a3a78] admin-dark:text-[#93c5fd]" />
        </div>
      </div>

      {/* Enrolled Courses */}
      <div className={`${cardClass} mt-4 p-5`}>
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Enrolled Courses ({enrollments.length})
        </h3>
        {enrollments.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-neutral-300 p-4 text-center text-xs font-semibold text-slate-500 admin-dark:border-zinc-700">
            No enrollments yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {enrollments.map((enrollment) => (
              <li
                key={enrollment.courseId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f8fbff] px-4 py-3 admin-dark:bg-[#132a4f]/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#0b1e3a] admin-dark:text-zinc-100">
                    {enrollment.courseName}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {enrollment.courseType} · {formatFee(enrollment.fee)} · Enrolled {formatDate(enrollment.enrolledAt)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${enrollment.status === "active" ? "bg-emerald-500/10 text-emerald-600 admin-dark:text-emerald-400" : enrollment.status === "pending" ? "bg-yellow-500/10 text-yellow-600 admin-dark:text-yellow-400" : "bg-zinc-200 text-slate-500 admin-dark:bg-zinc-700 admin-dark:text-zinc-300"}`}>
                  {enrollment.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Learning Progress */}
      <div className={`${cardClass} mt-4 p-5`}>
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Learning Progress ({progress.length})
        </h3>
        {progress.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-neutral-300 p-4 text-center text-xs font-semibold text-slate-500 admin-dark:border-zinc-700">
            No learning activity yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {progress.map((course) => (
              <li
                key={course.courseId}
                className="rounded-xl bg-[#f8fbff] px-4 py-3 admin-dark:bg-[#132a4f]/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#0b1e3a] admin-dark:text-zinc-100">
                    {course.courseName}
                  </p>
                  <span className="text-xs font-extrabold text-[#1a3a78] admin-dark:text-[#93c5fd]">
                    {course.completedClasses}/{course.totalClasses} · {course.percent}%
                  </span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-[#e2e8f0] admin-dark:bg-[#0f2547]"
                  role="progressbar"
                  aria-valuenow={course.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${course.courseName} progress`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#1a3a78] to-[#2f6bce] admin-dark:from-[#234e9f] admin-dark:to-[#3b82f6]"
                    style={{ width: `${Math.min(100, Math.max(0, course.percent))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Exam Results */}
      <div className={`${cardClass} mt-4 p-5`}>
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Exam Results ({examResults.length})
        </h3>
        {examResults.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-neutral-300 p-4 text-center text-xs font-semibold text-slate-500 admin-dark:border-zinc-700">
            No exam results yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {examResults.map((result) => (
              <li
                key={result.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f8fbff] px-4 py-3 admin-dark:bg-[#132a4f]/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#0b1e3a] admin-dark:text-zinc-100">
                    {result.examTitle}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {formatDateTime(result.submittedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-extrabold text-[#0b1e3a] admin-dark:text-zinc-100">
                    {result.score}/{result.totalMarks}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    result.percentage >= 60 ? "bg-emerald-500/10 text-emerald-600 admin-dark:text-emerald-400" :
                    result.percentage >= 40 ? "bg-yellow-500/10 text-yellow-600 admin-dark:text-yellow-400" :
                    "bg-red-500/10 text-red-500 admin-dark:text-red-400"
                  }`}>
                    {result.percentage}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AdminConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget?.active ? "Activate this account?" : "Deactivate this account?"}
        message={
          confirmTarget
            ? `${student.fullName} (${student.studentId}) will ${
                confirmTarget.active ? "regain access" : "lose access"
              } to enrolled content. Authentication credentials are not modified.`
            : ""
        }
        confirmLabel={confirmTarget?.active ? "Activate" : "Deactivate"}
        danger={!confirmTarget?.active}
        onConfirm={() => {
          if (confirmTarget) handleToggleActive(confirmTarget.active);
        }}
        onClose={() => setConfirmTarget(null)}
      />
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="font-mono text-sm text-slate-700 admin-dark:text-zinc-200">{value}</dd>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-[#dbeafe] bg-[#f8fbff] p-3 text-center admin-dark:border-[#1e3a65] admin-dark:bg-[#0f2547]">
      <p className={`text-lg font-extrabold ${color}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    </div>
  );
}
