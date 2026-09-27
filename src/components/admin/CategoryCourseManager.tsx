"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessLoading, AccessMessage } from "@/components/auth/AccessGuard";
import AdminCenterLoader from "@/components/admin/AdminCenterLoader";
import {
  useAdminGate,
  noticeClass,
  cardClass,
  inputClass,
  labelClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  buttonDangerClass,
  type Notice,
} from "@/components/admin/admin-ui";
import { MediaUploadField } from "@/components/admin/MediaUploadField";
import type { CatalogCourse, CourseDetails } from "@/lib/courses-admin";

export type CategoryCourse = CatalogCourse & {
  totalClasses?: number;
  totalExams?: number;
  mentorIds?: string[];
};

type MentorOption = { id: string; name: string };
type BatchOption = { id: string; label?: string };

const EMPTY_FORM = {
  slug: "",
  name: "",
  batchId: "hsc-28",
  image: "",
  shortDescription: "",
  description: "",
  duration: "",
  fee: "0",
  discountFee: "",
  overviewTitle: "Chapters",
  status: "unpublished" as "published" | "unpublished",
  couponEnabled: false,
  featured: false,
  qaAccess: true,
  contentLayout: "flow-1" as "flow-1" | "flow-2" | "flow-3" | "flow-4" | "flow-5",
  totalClasses: "",
  totalExams: "",
  courseDuration: "",
  courseDescription: "",
  courseFeatures: "",
  courseTopics: "",
  chapterOverview: "",
  teachersJson: "[]",
  routineUrls: [] as string[],
};

type FormState = typeof EMPTY_FORM;

function defaultBatchFor(slug: string): string {
  return slug.includes("ssc") ? "ssc-29" : "hsc-29";
}

/**
 * One Course Control category's course list. The category context is fixed
 * for the entire flow — search, filters, cards, Add/Edit all operate ONLY on
 * this category's courses (GET ?categoryId= / POST with locked category_id).
 */
export default function CategoryCourseManager({
  category,
}: {
  category: { id: string; name: string; slug: string };
}) {
  const gate = useAdminGate();
  const [courses, setCourses] = useState<CategoryCourse[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Monotonic request id — a slow earlier response can never overwrite the
  // result of a newer load (retry / save).
  const requestRef = useRef(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mentorIds, setMentorIds] = useState<string[]>([]);
  const [mentorOptions, setMentorOptions] = useState<MentorOption[]>([]);
  const [batchOptions, setBatchOptions] = useState<BatchOption[]>([]);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "unpublished">("all");
  const [featuredFilter, setFeaturedFilter] = useState<"all" | "featured" | "normal">("all");
  const [routineUploading, setRoutineUploading] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [routinePreview, setRoutinePreview] = useState<string | null>(null);

  // Deep links: ?edit=<slug> opens that course's edit form, ?add=1 opens add.
  const searchParams = useSearchParams();
  const requestedEditSlug = searchParams.get("edit");
  const autoAdd = searchParams.get("add") === "1";

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    // Enter LOADING: reset to null so a retry never renders a stale `[]` as
    // a false "No courses available" while the new request is still pending.
    setLoadError(false);
    setCourses(null);
    try {
      const response = await fetch(
        `/api/admin/courses?categoryId=${encodeURIComponent(category.id)}`,
        { cache: "no-store", headers: gate.headers },
      );
      if (!response.ok) throw new Error("failed");
      const data = (await response.json()) as { courses?: CategoryCourse[] };
      const list = data.courses ?? [];
      // A superseded (slow earlier) response must never overwrite newer state.
      if (requestRef.current !== requestId) return;
      setCourses(list);

      if (requestedEditSlug) {
        const target = list.find((course) => course.slug === requestedEditSlug);
        if (target) openEdit(target);
        else
          setNotice({
            kind: "error",
            text: `Course “${requestedEditSlug}” was not found in this category.`,
          });
      } else if (autoAdd) {
        startCreate();
      }
    } catch {
      if (requestRef.current !== requestId) return;
      // ERROR keeps courses as null (never `[]`) so the UI shows Try Again —
      // never a false empty state.
      setLoadError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit/startCreate are stable setters
  }, [category.id, gate.headers, requestedEditSlug, autoAdd]);

  // Batch options come from the existing filter editor (scope by category).
  useEffect(() => {
    if (!gate.ready) return;
    fetch("/api/admin/course-filters", { cache: "no-store", headers: gate.headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { ssc?: BatchOption[]; hsc?: BatchOption[] } | null) => {
        const scoped = category.slug.includes("ssc")
          ? data?.ssc ?? []
          : data?.hsc ?? [];
        setBatchOptions(scoped.length > 0 ? scoped : [{ id: "all", label: "All Batches" }]);
      })
      .catch(() => setBatchOptions([{ id: "all", label: "All Batches" }]));
  }, [gate.ready, gate.headers, category.slug]);

  // Mentor options for the course↔mentor assignment picker.
  useEffect(() => {
    if (!gate.ready) return;
    fetch("/api/mentors", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { mentors?: MentorOption[] } | null) =>
        setMentorOptions(
          (data?.mentors ?? []).map((mentor) => ({
            id: mentor.id,
            name: mentor.name,
          })),
        ),
      )
      .catch(() => setMentorOptions([]));
  }, [gate.ready]);

  useEffect(() => {
    if (gate.ready)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- standard admin gate load
      void load();
  }, [gate.ready, load]);

  if (!gate.ready) {
    return gate.denied ? (
      <AccessMessage
        title="Administrators only"
        message="Course management is restricted to authorized administrators."
        actionLabel="Back to Admin Home"
        actionHref="/admin"
      />
    ) : (
      <AccessLoading label="Loading courses..." />
    );
  }

  function startCreate() {
    setForm({
      ...EMPTY_FORM,
      batchId: defaultBatchFor(category.slug),
    });
    setMentorIds([]);
    setEditingSlug(null);
    setShowForm(true);
    setNotice(null);
    setRoutineError(null);
    setRoutinePreview(null);
  }

  function openEdit(course: CategoryCourse) {
    const details = course.courseDetails;
    setForm({
      slug: course.slug,
      name: course.name,
      batchId: course.batchId || defaultBatchFor(category.slug),
      image: course.image ?? "",
      shortDescription: course.shortDescription ?? "",
      description: course.description ?? "",
      duration: course.duration,
      fee: String(course.fee),
      discountFee: course.discountFee == null ? "" : String(course.discountFee),
      overviewTitle: course.overviewTitle || "Chapters",
      status: course.status,
      couponEnabled: course.couponEnabled,
      featured: course.featured,
      qaAccess: course.qaAccess !== false,
      contentLayout: (course.contentLayout === "flow-1" || course.contentLayout === "flow-2" || course.contentLayout === "flow-3" || course.contentLayout === "flow-4" || course.contentLayout === "flow-5"
        ? course.contentLayout
        : String(course.contentLayout) === "paper" ? "flow-2" : String(course.contentLayout) === "subject" ? "flow-3" : "flow-1"),
      totalClasses: course.totalClasses != null ? String(course.totalClasses) : "",
      totalExams: course.totalExams != null ? String(course.totalExams) : "",
      courseDuration: details?.duration ?? "",
      courseDescription: details?.description ?? "",
      courseFeatures: (course.features ?? []).join("\n"),
      courseTopics: (details?.topics ?? []).join("\n"),
      chapterOverview: (details?.chapterOverview ?? []).join("\n"),
      teachersJson: JSON.stringify(details?.teachers ?? []),
      routineUrls: course.routineUrls ?? [],
    });
    setMentorIds(course.mentorIds ?? []);
    // Mentor assignments are per-course — refresh from the server so an
    // edit never wipes assignments made elsewhere.
    if (!course.mentorIds) {
      fetch(`/api/admin/courses?slug=${encodeURIComponent(course.slug)}`, {
        cache: "no-store",
        headers: gate.headers,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { course?: CategoryCourse } | null) =>
          setMentorIds(data?.course?.mentorIds ?? []),
        )
        .catch(() => undefined);
    }
    setEditingSlug(course.slug);
    setShowForm(true);
    setNotice(null);
    setRoutineError(null);
    setRoutinePreview(null);
  }

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      let teachers: CourseDetails["teachers"] = [];
      try {
        teachers = JSON.parse(form.teachersJson || "[]") as CourseDetails["teachers"];
      } catch { /* ignore */ }
      if (!teachers) teachers = [];
      const courseDetails: CourseDetails = {
        duration: form.courseDuration.trim() || undefined,
        description: form.courseDescription.trim() || undefined,
        teachers: teachers.length > 0 ? teachers : undefined,
        topics: form.courseTopics.split("\n").map((s) => s.trim()).filter(Boolean),
        chapterOverview: form.chapterOverview.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      const response = await fetch("/api/admin/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({
          ...form,
          // Mandatory relationship — the open category owns this course.
          categoryId: category.id,
          features: form.courseFeatures.split("\n").map((s) => s.trim()).filter(Boolean),
          mentorIds,
          fee: Number(form.fee) || 0,
          discountFee:
            form.discountFee.trim() === "" ? null : Number(form.discountFee),
          totalClasses: form.totalClasses.trim() === "" ? null : Number(form.totalClasses),
          totalExams: form.totalExams.trim() === "" ? null : Number(form.totalExams),
          courseDetails,
          routineUrls: form.routineUrls,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        course?: CategoryCourse;
      } | null;
      if (!response.ok) {
        // The row may still have been persisted (post-save step failed) —
        // refresh so the list reflects reality either way.
        await load();
        setNotice({ kind: "error", text: data?.error ?? "Failed to save." });
        return;
      }
      setShowForm(false);
      await load();
      setNotice({
        kind: "success",
        text: `“${data?.course?.name ?? form.name}” saved to ${category.name}.`,
      });
    } catch {
      setNotice({ kind: "error", text: "Failed to save the course." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlags(
    slug: string,
    label: string,
    patch: {
      status?: "published" | "unpublished";
      featured?: boolean;
      qaAccess?: boolean;
    },
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/courses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({ slug, ...patch }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice({ kind: "error", text: data?.error ?? "Failed to update." });
        return;
      }
      await load();
      setNotice({ kind: "success", text: `“${label}” updated.` });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(slug: string, name: string) {
    if (
      !window.confirm(
        `Delete “${name}” completely?\n\n` +
          `Removes the course, its subject/content links, mentors, featured entry and homepage card. ` +
          `Student enrollment records are kept.\n\nThis cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/courses", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...gate.headers },
        body: JSON.stringify({ slug }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice({ kind: "error", text: data?.error ?? "Failed to delete." });
        return;
      }
      await load();
      setNotice({ kind: "success", text: `“${name}” deleted.` });
    } finally {
      setBusy(false);
    }
  }

  function isRoutinePdf(url: string): boolean {
    return /\.pdf(\?|$)/i.test(url);
  }

  async function uploadRoutineFiles(files: FileList | File[]) {
    if (!gate.token) {
      setRoutineError("Not authorized — please sign in as an admin.");
      return;
    }
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    const allowed = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".ico"];
    for (const f of fileArray) {
      const dot = f.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : f.name.slice(dot).toLowerCase();
      if (!allowed.includes(ext)) {
        setRoutineError(`Unsupported file type "${ext || f.name}" — use PDF or images.`);
        return;
      }
      if (f.size > 20 * 1024 * 1024) {
        setRoutineError(`"${f.name}" exceeds 20 MB limit.`);
        return;
      }
    }
    if (form.routineUrls.length + fileArray.length > 20) {
      setRoutineError("Maximum 20 routine pages allowed.");
      return;
    }
    setRoutineError(null);
    setRoutineUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of fileArray) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("dir", "routines");
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: fd,
          headers: { Authorization: `Bearer ${gate.token}` },
        });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || "Upload failed.");
        uploaded.push(data.url);
      }
      setForm((prev) => ({ ...prev, routineUrls: [...prev.routineUrls, ...uploaded] }));
    } catch (e) {
      setRoutineError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setRoutineUploading(false);
    }
  }

  async function replaceRoutineAt(index: number, file: File) {
    if (!gate.token) {
      setRoutineError("Not authorized.");
      return;
    }
    setRoutineError(null);
    setRoutineUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dir", "routines");
      const prevUrl = form.routineUrls[index];
      if (prevUrl) fd.append("previousUrl", prevUrl);
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${gate.token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed.");
      setForm((prev) => {
        const next = [...prev.routineUrls];
        next[index] = data.url!;
        return { ...prev, routineUrls: next };
      });
    } catch (e) {
      setRoutineError(e instanceof Error ? e.message : "Replace failed.");
    } finally {
      setRoutineUploading(false);
    }
  }

  function removeRoutineAt(index: number) {
    setForm((prev) => ({ ...prev, routineUrls: prev.routineUrls.filter((_, i) => i !== index) }));
    setRoutineError(null);
  }

  // Filters + search apply ONLY to this category's courses. Computed after
  // the gate early-returns, so plain filtering keeps hook order stable.
  const term = search.trim().toLowerCase();  const filtered = (courses ?? []).filter((course) => {
    if (term && !`${course.name} ${course.slug}`.toLowerCase().includes(term))
      return false;
    if (batchFilter !== "all" && course.batchId !== batchFilter) return false;
    if (statusFilter !== "all" && course.status !== statusFilter) return false;
    if (featuredFilter === "featured" && !course.featured) return false;
    if (featuredFilter === "normal" && course.featured) return false;
    return true;
  });

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <nav className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        <Link href="/admin/course" className="transition hover:text-[#1a3a78]">
          Course Control
        </Link>
        <span aria-hidden="true">→</span>
        <span className="text-[#0b1e3a] admin-dark:text-zinc-100">{category.name}</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0b1e3a] admin-dark:text-white">
            {category.name} — Courses
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500 admin-dark:text-slate-400">
            Only courses belonging to {category.name} are listed here.
          </p>
        </div>
        <button type="button" onClick={startCreate} className={buttonPrimaryClass}>
          + Add Course
        </button>
      </header>

      {/* Search + filters — scoped to this category only */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${category.name} courses…`}
          className={inputClass}
        />
        <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className={inputClass} aria-label="Batch filter">
          {(batchOptions.length > 0
            ? batchOptions
            : [{ id: "all", label: "All Batches" }]
          ).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label ?? option.id}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className={inputClass}
          aria-label="Status filter"
        >
          <option value="all">All Statuses</option>
          <option value="published">Published</option>
          <option value="unpublished">Unpublished</option>
        </select>
        <select
          value={featuredFilter}
          onChange={(e) => setFeaturedFilter(e.target.value as typeof featuredFilter)}
          className={inputClass}
          aria-label="Featured filter"
        >
          <option value="all">Featured &amp; Normal</option>
          <option value="featured">★ Featured only</option>
          <option value="normal">Normal only</option>
        </select>
      </div>

      {loadError ? (
        <div className={`${cardClass} mt-5 p-8 text-center`}>
          <p className="text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
            Could not load courses.
          </p>
          <button type="button" onClick={() => void load()} className={`${buttonPrimaryClass} mt-4`}>
            Try Again
          </button>
        </div>
      ) : courses === null ? (
        <AdminCenterLoader label="Loading courses…" />
      ) : filtered.length === 0 ? (
        <div className="mt-5">
          <p className={`${cardClass} p-8 text-center text-sm text-slate-500`}>
            No courses available in this category.
          </p>
          <button type="button" onClick={startCreate} className={`${buttonPrimaryClass} mt-4 w-full py-3`}>
            + Add Course
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-5 space-y-3">
            {filtered.map((course) => (
              <li key={course.slug} className={`${cardClass} p-4 sm:p-5`}>
                <div className="flex flex-wrap items-start gap-3">
                  {course.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={course.image}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded-lg border border-neutral-200 object-cover admin-dark:border-zinc-700"
                    />
                  ) : (
                    <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-[10px] font-bold uppercase text-slate-400 admin-dark:border-zinc-700">
                      No banner
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/course/category/${encodeURIComponent(category.id)}/course/${encodeURIComponent(course.slug)}`}
                        className="truncate text-base font-bold text-[#0b1e3a] transition hover:text-[#1a3a78] admin-dark:text-zinc-100"
                      >
                        {course.name}
                      </Link>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                          course.status === "published"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-zinc-500/10 text-slate-500"
                        }`}
                      >
                        {course.status}
                      </span>
                      {course.featured && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-600">
                          ★ Featured
                        </span>
                      )}
                      {course.couponEnabled && (
                        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-sky-600">
                          Coupon
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
                          course.qaAccess !== false
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        Q&A: {course.qaAccess !== false ? "ON" : "OFF"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      Batch {course.batchId.toUpperCase()} · Regular ৳{" "}
                      {course.fee.toLocaleString("en-IN")}
                      {course.discountFee != null &&
                        ` · Discount ৳ ${course.discountFee.toLocaleString("en-IN")}`}
                      {" · "}
                      {course.totalClasses ?? 0} classes · {course.totalExams ?? 0} exams
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    <Link
                      href={`/admin/course/category/${encodeURIComponent(category.id)}/course/${encodeURIComponent(course.slug)}`}
                      className={buttonSecondaryClass}
                    >
                      View Details
                    </Link>
                    <button type="button" onClick={() => openEdit(course)} className={buttonSecondaryClass}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Toggle Q&A access for ${course.name}`}
                      title={course.qaAccess !== false ? "Turn Q&A OFF" : "Turn Q&A ON"}
                      onClick={() =>
                        void toggleFlags(course.slug, course.name, {
                          qaAccess: !(course.qaAccess !== false),
                        })
                      }
                      className={
                        course.qaAccess !== false
                          ? "rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 transition hover:bg-emerald-500/20"
                          : "rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-500/20"
                      }
                    >
                      Q&A: {course.qaAccess !== false ? "ON" : "OFF"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void toggleFlags(course.slug, course.name, {
                          status:
                            course.status === "published" ? "unpublished" : "published",
                        })
                      }
                      className={buttonSecondaryClass}
                    >
                      {course.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Toggle featured for ${course.name}`}
                      title={course.featured ? "Remove from featured" : "Mark as featured"}
                      onClick={() =>
                        void toggleFlags(course.slug, course.name, {
                          featured: !course.featured,
                        })
                      }
                      className={
                        course.featured
                          ? "rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-600 transition hover:bg-amber-500/20"
                          : buttonSecondaryClass
                      }
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(course.slug, course.name)}
                      disabled={busy}
                      aria-label={`Delete ${course.name}`}
                      className={buttonDangerClass}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <button type="button" onClick={startCreate} className={`${buttonPrimaryClass} mt-5 w-full py-3`}>
            + Add Course
          </button>
        </>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
        >
          <div className={`${cardClass} max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-2xl sm:p-6`}>
            <h3 className="text-lg font-extrabold text-[#0b1e3a] admin-dark:text-zinc-100">
              {editingSlug ? "Edit Course" : "Add Course"}
            </h3>

            {/* Locked category — the admin is already inside it. */}
            <div className="mt-4 rounded-xl border border-primary-500/40 bg-primary-600/5 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-primary-600">
                Category (locked)
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#0b1e3a] admin-dark:text-zinc-100">
                {category.name}
              </p>
            </div>

            {/* ── Course Card Information ── */}
            <div className="mt-5 rounded-xl border border-primary-500/40 bg-primary-600/5 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-primary-600">
                Course Card Information
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="ccm-image">Course Banner</label>
                <MediaUploadField
                  id="ccm-image"
                  label=""
                  value={form.image}
                  onChange={(url) => setForm({ ...form, image: url })}
                  directory="courses"
                  preview
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-batch">Course Batch</label>
                <select id="ccm-batch" className={inputClass} value={form.batchId}
                  onChange={(e) => setForm({ ...form, batchId: e.target.value })}>
                  <option value="hsc-29">HSC 29</option>
                  <option value="hsc-28">HSC 28</option>
                  <option value="hsc-27">HSC 27</option>
                  <option value="hsc-26">HSC 26</option>
                  <option value="ssc-29">SSC 29</option>
                  <option value="ssc-28">SSC 28</option>
                  <option value="ssc-27">SSC 27</option>
                  <option value="ssc-26">SSC 26</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-name">Course Name</label>
                <input id="ccm-name" className={inputClass} value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-slug">
                  Course Slug (lowercase, URL-friendly)
                </label>
                <input id="ccm-slug" className={inputClass} value={form.slug} disabled={Boolean(editingSlug)}
                  placeholder="ssc-biology-advanced"
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-total-classes">Total Classes</label>
                <input id="ccm-total-classes" type="number" min="0" className={inputClass} value={form.totalClasses}
                  placeholder="e.g. 48"
                  onChange={(e) => setForm({ ...form, totalClasses: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-total-exams">Total Exams</label>
                <input id="ccm-total-exams" type="number" min="0" className={inputClass} value={form.totalExams}
                  placeholder="e.g. 12"
                  onChange={(e) => setForm({ ...form, totalExams: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-fee">Original Course Fee (৳)</label>
                <input id="ccm-fee" type="number" min="0" className={inputClass} value={form.fee}
                  onChange={(e) => setForm({ ...form, fee: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} htmlFor="ccm-discount">Discount Fee (optional, ৳)</label>
                <input id="ccm-discount" type="number" min="0" className={inputClass} value={form.discountFee}
                  onChange={(e) => setForm({ ...form, discountFee: e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={form.status === "published"}
                    onChange={(e) => setForm({ ...form, status: e.target.checked ? "published" : "unpublished" })} />
                  Published
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={form.couponEnabled}
                    onChange={(e) => setForm({ ...form, couponEnabled: e.target.checked })} />
                  Coupon enabled
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={form.featured}
                    onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
                  ★ Featured Course
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 admin-dark:text-zinc-200">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={form.qaAccess}
                    onChange={(e) => setForm({ ...form, qaAccess: e.target.checked })} />
                  Q&A Access: {form.qaAccess ? "ON" : "OFF"}
                </label>
              </div>
            </div>

            {/* ── Course Details ── */}
            <div className="mt-6 rounded-xl border border-primary-500/40 bg-primary-600/5 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-primary-600">
                Course Details
              </p>
              <p className="mt-0.5 text-xs text-slate-500 admin-dark:text-slate-400">
                Additional information shown on the course details page.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="ccm-cd-duration">Course Duration</label>
                <input id="ccm-cd-duration" className={inputClass} value={form.courseDuration}
                  placeholder="e.g. 6 months"
                  onChange={(e) => setForm({ ...form, courseDuration: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Select Course Content Flow *</label>
                <p className="mb-3 text-xs text-slate-500 admin-dark:text-slate-400">
                  Choose how content is organized for students. This cannot be changed later without affecting existing content.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {/* Flow 1 — Direct */}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contentLayout: "flow-1" })}
                    className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition ${
                      form.contentLayout === "flow-1"
                        ? "border-primary-500/60 bg-primary-600/10 shadow-md shadow-primary-900/20"
                        : "border-ink/15 bg-dark-900 hover:border-primary-500/30"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className={`text-sm font-bold ${form.contentLayout === "flow-1" ? "text-primary-700 admin-dark:text-primary-300" : "text-heading"}`}>
                        Flow 1
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        form.contentLayout === "flow-1"
                          ? "bg-primary-500/20 text-primary-700 admin-dark:text-primary-300"
                          : "bg-ink/10 text-neutral-500"
                      }`}>
                        Direct
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400">Basic/simple subject-based course</p>
                    {/* Hierarchy preview */}
                    <div className="mt-3 w-full rounded-lg border border-ink/10 bg-dark-950 p-2.5">
                      <div className="flex flex-col gap-1 text-[10px]">
                        <div className="rounded bg-primary-500/15 px-2 py-1 text-center font-bold text-primary-300">Course</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Class / Exam / Materials / Archive</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Chapter</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Content</div>
                      </div>
                    </div>
                    {form.contentLayout === "flow-1" && (
                      <div className="absolute right-2 top-2">
                        <svg className="h-5 w-5 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Flow 2 — Paper */}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contentLayout: "flow-2" })}
                    className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition ${
                      form.contentLayout === "flow-2"
                        ? "border-primary-500/60 bg-primary-600/10 shadow-md shadow-primary-900/20"
                        : "border-ink/15 bg-dark-900 hover:border-primary-500/30"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className={`text-sm font-bold ${form.contentLayout === "flow-2" ? "text-primary-700 admin-dark:text-primary-300" : "text-heading"}`}>
                        Flow 2
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        form.contentLayout === "flow-2"
                          ? "bg-primary-500/20 text-primary-700 admin-dark:text-primary-300"
                          : "bg-ink/10 text-neutral-500"
                      }`}>
                        Paper
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400">Paper-based course (1st/2nd Paper)</p>
                    {/* Hierarchy preview */}
                    <div className="mt-3 w-full rounded-lg border border-ink/10 bg-dark-950 p-2.5">
                      <div className="flex flex-col gap-1 text-[10px]">
                        <div className="rounded bg-primary-500/15 px-2 py-1 text-center font-bold text-primary-300">Course</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">1st Paper / 2nd Paper</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Class / Exam / Materials / Archive</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Chapter</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Content</div>
                      </div>
                    </div>
                    {form.contentLayout === "flow-2" && (
                      <div className="absolute right-2 top-2">
                        <svg className="h-5 w-5 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Flow 3 — Subject */}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contentLayout: "flow-3" })}
                    className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition ${
                      form.contentLayout === "flow-3"
                        ? "border-primary-500/60 bg-primary-600/10 shadow-md shadow-primary-900/20"
                        : "border-ink/15 bg-dark-900 hover:border-primary-500/30"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className={`text-sm font-bold ${form.contentLayout === "flow-3" ? "text-primary-700 admin-dark:text-primary-300" : "text-heading"}`}>
                        Flow 3
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        form.contentLayout === "flow-3"
                          ? "bg-primary-500/20 text-primary-700 admin-dark:text-primary-300"
                          : "bg-ink/10 text-neutral-500"
                      }`}>
                        Subject
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400">Multi-subject course (Medical Admission)</p>
                    {/* Hierarchy preview */}
                    <div className="mt-3 w-full rounded-lg border border-ink/10 bg-dark-950 p-2.5">
                      <div className="flex flex-col gap-1 text-[10px]">
                        <div className="rounded bg-primary-500/15 px-2 py-1 text-center font-bold text-primary-300">Course</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Subject</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Class / Exam / Materials / Archive</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Chapter</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Content</div>
                      </div>
                    </div>
                    {form.contentLayout === "flow-3" && (
                      <div className="absolute right-2 top-2">
                        <svg className="h-5 w-5 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>

                  {/* Course Flow 4 — Exam Flow (Course → 4 Exam Cards) */}
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, contentLayout: "flow-5" })}
                    className={`group relative flex flex-col items-start rounded-xl border p-4 text-left transition ${
                      form.contentLayout === "flow-5"
                        ? "border-primary-500/60 bg-primary-600/10 shadow-md shadow-primary-900/20"
                        : "border-ink/15 bg-dark-900 hover:border-primary-500/30"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className={`text-sm font-bold ${form.contentLayout === "flow-5" ? "text-primary-700 admin-dark:text-primary-300" : "text-heading"}`}>
                        Course Flow 4
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        form.contentLayout === "flow-5"
                          ? "bg-primary-500/20 text-primary-700 admin-dark:text-primary-300"
                          : "bg-ink/10 text-neutral-500"
                      }`}>
                        Exam Flow
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-400">Course → 4 exam cards (topic-wise + finals)</p>
                    {/* Hierarchy preview */}
                    <div className="mt-3 w-full rounded-lg border border-ink/10 bg-dark-950 p-2.5">
                      <div className="flex flex-col gap-1 text-[10px]">
                        <div className="rounded bg-primary-500/15 px-2 py-1 text-center font-bold text-primary-300">Course</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Topic-wise / Paper / Subject / Model</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Subject (topic-wise only)</div>
                        <div className="ml-2 text-center text-neutral-600">↓</div>
                        <div className="rounded bg-ink/10 px-2 py-1 text-center font-semibold text-neutral-300">Exam</div>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] leading-tight text-neutral-500">Topic-wise → 8 subjects; finals list exams directly</p>
                    {form.contentLayout === "flow-5" && (
                      <div className="absolute right-2 top-2">
                        <svg className="h-5 w-5 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="ccm-short">Short description</label>
                <textarea id="ccm-short" rows={2} className={inputClass} value={form.shortDescription}
                  onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="ccm-cd-desc">Course Description (detailed)</label>
                <textarea id="ccm-cd-desc" rows={4} className={inputClass} value={form.courseDescription}
                  placeholder="Detailed description for the course details page..."
                  onChange={(e) => setForm({ ...form, courseDescription: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="ccm-features">Course Features (one per line)</label>
                <textarea id="ccm-features" rows={4} className={inputClass} value={form.courseFeatures}
                  placeholder={"Structured live classes\nRegular examinations\nStudy materials\nExpert guidance"}
                  onChange={(e) => setForm({ ...form, courseFeatures: e.target.value })} />
                <p className="mt-1 text-[11px] text-slate-500">Shown on the Course Details page as “Course Features”. Reorder by moving lines.</p>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="ccm-topics">Course Topics (one per line)</label>
                <textarea id="ccm-topics" rows={4} className={inputClass} value={form.courseTopics}
                  placeholder={"What Will Be Taught:\nBiology fundamentals\nCell structure\nEvolution"}
                  onChange={(e) => setForm({ ...form, courseTopics: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="ccm-overview">Chapter/Subject Overview (one per line)</label>
                <textarea id="ccm-overview" rows={4} className={inputClass} value={form.chapterOverview}
                  placeholder={"Chapter 1: Introduction\nChapter 2: Cell Biology\nChapter 3: Genetics"}
                  onChange={(e) => setForm({ ...form, chapterOverview: e.target.value })} />
              </div>

              {/* Mentors assignment — specific to THIS course. */}
              <div className="sm:col-span-2">
                <span className={labelClass}>Mentors (this course)</span>
                {mentorOptions.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    No mentors available — add them in Admin → Mentors first.
                  </p>
                ) : (
                  <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-neutral-200 p-3 admin-dark:border-zinc-700">
                    {mentorOptions.map((mentor) => (
                      <label key={mentor.id} className="flex items-center gap-2 text-sm text-slate-700 admin-dark:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={mentorIds.includes(mentor.id)}
                          onChange={(event) =>
                            setMentorIds(
                              event.target.checked
                                ? [...mentorIds, mentor.id]
                                : mentorIds.filter((id) => id !== mentor.id),
                            )
                          }
                        />
                        <span className="truncate">{mentor.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Course Routine (at the very end of the form) ── */}
            <div className="mt-6 rounded-xl border border-primary-500/40 bg-primary-600/5 px-4 py-3 sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-wide text-primary-600">
                Course Routine
              </p>
              <p className="mt-0.5 text-xs text-slate-500 admin-dark:text-slate-400">
                Upload the course routine — PDF, single image, or multi-page images. Students will see it in Course Details under “Routine”.
              </p>
            </div>

            <div className="mt-4 space-y-4 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`${buttonSecondaryClass} cursor-pointer ${routineUploading ? "opacity-50 pointer-events-none" : ""}`}>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,.ico"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void uploadRoutineFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {routineUploading ? "Uploading…" : "+ Upload Routine"}
                </label>
                <span className="text-xs text-slate-500 admin-dark:text-slate-400">
                  PDF or images • multiple files = multi-page • max 20 pages • 20 MB each
                </span>
                {form.routineUrls.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Remove all routine files?")) setForm((p) => ({ ...p, routineUrls: [] }));
                    }}
                    className="text-xs font-bold text-red-600 hover:text-red-700"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {routineError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 admin-dark:border-red-900/40 admin-dark:bg-red-500/10 admin-dark:text-red-400">
                  {routineError}
                </p>
              )}

              {form.routineUrls.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center admin-dark:border-zinc-700 admin-dark:bg-zinc-900/30">
                  <p className="text-sm font-semibold text-slate-600 admin-dark:text-zinc-300">No routine uploaded</p>
                  <p className="mt-1 text-xs text-slate-500 admin-dark:text-slate-400">Upload a PDF or image(s) — it will be saved with this course only.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {form.routineUrls.map((url, idx) => (
                    <li key={url + idx} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 admin-dark:border-zinc-700 admin-dark:bg-zinc-900">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600/10 text-primary-600 text-xs font-bold">
                        {isRoutinePdf(url) ? "PDF" : `#${idx + 1}`}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 admin-dark:text-zinc-200" title={url}>
                        {url.split("/").pop() || url}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isRoutinePdf(url) ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                        {isRoutinePdf(url) ? "PDF" : "Image"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRoutinePreview(url)}
                        className={buttonSecondaryClass + " px-2.5 py-1 text-[11px]"}
                      >
                        Preview
                      </button>
                      <label className={`${buttonSecondaryClass} cursor-pointer px-2.5 py-1 text-[11px] ${routineUploading ? "opacity-50 pointer-events-none" : ""}`}>
                        <input
                          type="file"
                          accept=".pdf,image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,.ico"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void replaceRoutineAt(idx, f);
                            e.target.value = "";
                          }}
                        />
                        Replace
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRoutineAt(idx)}
                        className={buttonDangerClass + " h-7 w-7 text-xs"}
                        aria-label={`Delete routine page ${idx + 1}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {routinePreview && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 admin-dark:border-zinc-700 admin-dark:bg-zinc-900">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700 admin-dark:text-zinc-200">Routine Preview</p>
                    <button type="button" onClick={() => setRoutinePreview(null)} className="text-xs font-bold text-slate-500 hover:text-slate-700">Close ✕</button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 admin-dark:border-zinc-700 admin-dark:bg-zinc-950">
                    {isRoutinePdf(routinePreview) ? (
                      <iframe src={routinePreview} title="Routine PDF preview" className="h-[420px] w-full" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={routinePreview} alt="Routine preview" className="max-h-[420px] w-full object-contain" />
                    )}
                  </div>
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-slate-500 admin-dark:text-slate-400">
                Tip: For a multi-page routine, upload several images in order — they will appear page-by-page for students. A single PDF is also supported with in-app viewing and zoom.
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={handleSave} disabled={busy || routineUploading} className={buttonPrimaryClass}>
                {busy ? "Saving…" : editingSlug ? "Update Course" : "Create Course"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className={buttonSecondaryClass}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed inset-x-4 bottom-4 z-[60] sm:left-auto sm:right-6 sm:max-w-sm">
          <p role="status" className={noticeClass(notice)}>
            {notice.text}
          </p>
        </div>
      )}
    </section>
  );
}
