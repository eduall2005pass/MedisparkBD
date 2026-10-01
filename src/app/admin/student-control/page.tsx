"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AccessLoading } from "@/components/auth/AccessGuard";

type Student = {
  uid: string;
  studentId?: string;
  fullName?: string;
  name?: string;
  email?: string;
  contactNumber?: string;
  isActive?: boolean;
  institution?: string;
  hscBatch?: string;
};

type CourseOption = {
  slug: string;
  name: string;
  totalApplications: number;
};

type Tab = "all" | "enrolled" | "active" | "inactive";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "all", label: "All Students" },
  { key: "enrolled", label: "Enrolled Students" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

export default function StudentControlPage() {
  const { user, authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [students, setStudents] = useState<Student[] | null>(null);
  const [enrolledUids, setEnrolledUids] = useState<Set<string> | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseSlug, setCourseSlug] = useState("");
  // Members keyed by course slug — avoids sync setState in effects.
  const [courseData, setCourseData] = useState<{
    slug: string;
    members: Map<string, string>;
  } | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(false);
    try {
      const auth = { Authorization: `Bearer ${await user.getIdToken()}` };
      const [studentsRes, enrollmentsRes, coursesRes] = await Promise.all([
        fetch("/api/admin/students?status=all", { headers: auth, cache: "no-store" }),
        fetch("/api/admin/enrollments?status=active", { headers: auth, cache: "no-store" }),
        fetch("/api/admin/enrollment-control/summary", { headers: auth, cache: "no-store" }),
      ]);
      if (!studentsRes.ok) throw new Error("failed");
      const data = (await studentsRes.json()) as { students?: Student[] };
      setStudents(Array.isArray(data.students) ? data.students : []);
      if (enrollmentsRes.ok) {
        const data = (await enrollmentsRes.json()) as {
          enrollments?: Array<{ studentUid: string }>;
        };
        setEnrolledUids(
          new Set((data.enrollments ?? []).map((item) => item.studentUid)),
        );
      }
      if (coursesRes.ok) {
        const data = (await coursesRes.json()) as { courses?: CourseOption[] };
        setCourses(Array.isArray(data.courses) ? data.courses : []);
      }
    } catch {
      setError(true);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [authLoading, user, load]);

  // Course-wise student control: members of the selected course.
  useEffect(() => {
    if (!user || !courseSlug || courseData?.slug === courseSlug) return;
    let cancelled = false;
    const slug = courseSlug;
    user
      .getIdToken()
      .then((token) =>
        fetch(`/api/admin/enrollments?course=${encodeURIComponent(slug)}&status=all`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { enrollments?: Array<{ studentUid: string; status: string }> } | null) => {
        if (cancelled) return;
        const members = new Map<string, string>();
        for (const item of data?.enrollments ?? []) {
          if (item.studentUid && !members.has(item.studentUid)) {
            members.set(item.studentUid, item.status);
          }
        }
        setCourseData({ slug, members });
      })
      .catch(() => {
        if (!cancelled) setCourseData({ slug, members: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [user, courseSlug, courseData]);

  async function setActive(student: Student, isActive: boolean) {
    if (!user) return;
    try {
      const res = await fetch("/api/admin/students", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ uid: student.uid, isActive }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      setStudents((prev) =>
        (prev ?? []).map((item) =>
          item.uid === student.uid ? { ...item, isActive } : item,
        ),
      );
    } catch {
      setError(true);
    }
  }

  const activeMembers =
    courseSlug !== "" && courseData?.slug === courseSlug
      ? courseData.members
      : null;

  const visible = useMemo(() => {
    let list = students ?? [];
    // Course-wise filter first.
    if (courseSlug) {
      if (!activeMembers) return [];
      list = list.filter((student) => activeMembers.has(student.uid));
    }
    switch (tab) {
      case "active":
        return list.filter((student) => student.isActive !== false);
      case "inactive":
        return list.filter((student) => student.isActive === false);
      case "enrolled":
        return list.filter(
          (student) => enrolledUids?.has(student.uid) ?? false,
        );
      default:
        return list;
    }
  }, [students, tab, enrolledUids, courseSlug, activeMembers]);

  // Phone-number list derived from the current view (tab + course filter).
  const phoneRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ name: string; phone: string; student: Student }> = [];
    for (const student of visible) {
      const phone = (student.contactNumber ?? "").trim();
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      rows.push({
        name: student.fullName || student.name || student.email || student.uid,
        phone,
        student,
      });
    }
    return rows;
  }, [visible]);
  const missingPhoneCount = visible.filter(
    (student) => !(student.contactNumber ?? "").trim(),
  ).length;

  async function copyPhones() {
    if (phoneRows.length === 0) return;
    const text = phoneRows.map((row) => row.phone).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API fallback (non-HTTPS / older browsers).
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function downloadFile(filename: string, content: string, mime: string) {
    const blob = new Blob(["\uFEFF" + content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportTxt() {
    downloadFile(
      "student-phones.txt",
      phoneRows.map((row) => row.phone).join("\n"),
      "text/plain",
    );
  }

  function exportCsv() {
    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const lines = ["Name,Phone,Student ID,Email"];
    for (const row of phoneRows) {
      lines.push(
        [
          escape(row.name),
          escape(row.phone),
          escape(row.student.studentId ?? ""),
          escape(row.student.email ?? ""),
        ].join(","),
      );
    }
    downloadFile("student-phones.csv", lines.join("\n"), "text/csv");
  }

  function exportExcel() {
    // Tab-separated .xls opens directly in MS Excel / Google Sheets — no dependency needed.
    const escape = (value: string) =>
      value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
    const lines = ["Name\tPhone\tStudent ID\tEmail"];
    for (const row of phoneRows) {
      lines.push(
        [
          escape(row.name),
          escape(row.phone),
          escape(row.student.studentId ?? ""),
          escape(row.student.email ?? ""),
        ].join("\t"),
      );
    }
    downloadFile("student-phones.xls", lines.join("\n"), "application/vnd.ms-excel");
  }

  if (authLoading || (!user && authLoading)) {
    return <AccessLoading label="Loading Student Control…" />;
  }

  const courseLoadingState = courseSlug !== "" && activeMembers === null;

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-heading">Student Control</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Registered MediSpark students and their account status.
      </p>

      {/* Course-wise Student Control */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label htmlFor="student-control-course" className="text-xs font-bold uppercase tracking-widest text-neutral-500">
          Course-wise
        </label>
        <select
          id="student-control-course"
          value={courseSlug}
          onChange={(event) => setCourseSlug(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-ink/5 px-4 py-2 text-sm font-semibold text-heading outline-none transition focus:border-primary-500/60 sm:max-w-xs"
        >
          <option value="">All Courses</option>
          {courses.map((course) => (
            <option key={course.slug} value={course.slug}>
              {course.name}
            </option>
          ))}
        </select>
        {courseSlug !== "" && (
          <button
            type="button"
            onClick={() => setCourseSlug("")}
            className="rounded-xl border border-ink/15 bg-ink/5 px-3 py-2 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 hover:text-heading"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              tab === item.key
                ? "border-primary-500/60 bg-primary-600/15 text-primary-300"
                : "border-ink/15 bg-ink/5 text-neutral-300 hover:border-primary-500/50 hover:text-heading"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Phone Numbers — one-click copy / TXT / CSV / Excel */}
      {students !== null && !courseLoadingState && !error && (
        <div className="mt-4 rounded-xl border border-[#dbeafe] bg-white shadow-sm shadow-[#0b1e3a]/5 admin-dark:border-[#1e3a65] admin-dark:bg-[#112544] px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-extrabold text-heading">
              Phone Numbers ({phoneRows.length})
            </h2>
            {missingPhoneCount > 0 && (
              <span className="text-[11px] text-neutral-500">
                · {missingPhoneCount} without number
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyPhones()}
                disabled={phoneRows.length === 0}
                className="rounded-lg border border-blue-500/40 bg-blue-600/10 px-3 py-1.5 text-xs font-bold text-blue-400 transition hover:bg-blue-600/20 disabled:opacity-40"
              >
                {copied ? "Copied!" : "One-click Copy"}
              </button>
              <button
                type="button"
                onClick={exportTxt}
                disabled={phoneRows.length === 0}
                className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-1.5 text-xs font-bold text-heading transition hover:border-primary-500/50 disabled:opacity-40"
              >
                TXT
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={phoneRows.length === 0}
                className="rounded-lg border border-ink/15 bg-ink/5 px-3 py-1.5 text-xs font-bold text-heading transition hover:border-primary-500/50 disabled:opacity-40"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={exportExcel}
                disabled={phoneRows.length === 0}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40"
              >
                Excel
              </button>
            </div>
          </div>
          {phoneRows.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500">
              No phone numbers in this view.
            </p>
          ) : (
            <p className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-ink/5 px-3 py-2 font-mono text-xs leading-relaxed text-heading">
              {phoneRows.map((row) => row.phone).join(", ")}
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-500">
            Follows the current tab + course filter. Duplicates removed.
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to load students. Please try again.
        </p>
      ) : students === null || courseLoadingState ? (
        <AccessLoading label="Loading students…" />
      ) : visible.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-ink/15 px-4 py-8 text-center text-sm text-neutral-500">
          {courseSlug !== ""
            ? "No students enrolled in this course yet."
            : "No students in this view."}
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {visible.map((student) => (
            <li
              key={student.uid}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-[#dbeafe] bg-white shadow-sm shadow-[#0b1e3a]/5 admin-dark:border-[#1e3a65] admin-dark:bg-[#112544] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-heading">
                  {student.fullName || student.name || student.email || student.uid}
                </p>
                <p className="truncate text-[11px] text-neutral-500">
                  {[student.studentId, student.email, student.institution]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {courseSlug !== "" && activeMembers?.get(student.uid) && (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                  {activeMembers.get(student.uid)}
                </span>
              )}
              {courseSlug === "" && enrolledUids?.has(student.uid) && (
                <span className="rounded-full border border-blue-500/30 bg-blue-600/10 px-2.5 py-1 text-[11px] font-bold text-blue-400">
                  Enrolled
                </span>
              )}
              <Link
                href={`/admin/students/details/${encodeURIComponent(student.uid)}`}
                className="rounded-lg border border-blue-500/40 bg-blue-600/10 px-3 py-1.5 text-xs font-bold text-blue-400 transition hover:bg-blue-600/20"
              >
                View Profile
              </Link>
              <button
                type="button"
                onClick={() => void setActive(student, student.isActive === false)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  student.isActive === false
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
                }`}
              >
                {student.isActive === false ? "Activate" : "Deactivate"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
