"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ExamCard from "@/components/ExamCard";
import PermissionGate from "@/components/auth/PermissionGate";
import { useAuth } from "@/lib/auth-context";
import type { EnrolledExamCourse } from "@/lib/enrolled-exams";
import type { CourseExamShortcut } from "@/lib/enrolled-exams-course-server";

export default function CourseExamShortcutView({ slug }: { slug: string }) {
  return (
    <PermissionGate requirement="course" courseSlug={slug} loadingLabel="Loading exams...">
      <CourseExamShortcutContent slug={slug} />
    </PermissionGate>
  );
}

function CourseExamShortcutContent({ slug }: { slug: string }) {
  const { user, authLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [course, setCourse] = useState<EnrolledExamCourse | null>(null);
  const [exams, setExams] = useState<CourseExamShortcut[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;
    const controller = new AbortController();
    const load = async () => {
      setState("loading");
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/my/course-exams?course=${encodeURIComponent(slug)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        const data = (await response.json()) as { course: EnrolledExamCourse; exams: CourseExamShortcut[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load your course exams.");
        if (controller.signal.aborted) return;
        if (data.course.direct_exam_route_url !== pathname) {
          router.replace(data.course.direct_exam_route_url);
          return;
        }
        setCourse(data.course);
        setExams(data.exams);
        setState("ready");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setCourse(null);
        setExams([]);
        setError(cause instanceof Error ? cause.message : "Could not load your course exams.");
        setState("error");
      }
    };
    void load();
    return () => controller.abort();
  }, [authLoading, user, slug, pathname, router, retry]);

  if (state === "loading") {
    return (
      <section className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 sm:px-6" role="status">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
        <p className="mt-4 text-sm font-semibold text-neutral-400">Loading course exams…</p>
      </section>
    );
  }
  if (state === "error") {
    return (
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center" role="alert">
          <p className="font-bold text-red-300">{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-4 rounded-xl bg-primary-600 px-6 py-3 font-semibold text-white">Try Again</button>
        </div>
      </section>
    );
  }
  const groups = [
    { status: "Live", title: "Live Now" },
    { status: "Upcoming", title: "Upcoming" },
    { status: "Archived", title: "Practice" },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary-500">{course?.course_name}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading sm:text-3xl">Course Exams</h1>
      </header>
      {exams.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-dark-900/60 p-10 text-center">
          <p className="font-semibold text-heading">No Exams Available</p>
          <p className="mt-1 text-sm text-neutral-400">No exams have been published for this course yet.</p>
        </div>
      ) : groups.map((group) => {
        const items = exams.filter((exam) => exam.status === group.status);
        if (items.length === 0) return null;
        return (
          <section key={group.status} className="mt-8" aria-label={group.title}>
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-heading">{group.title}</h2>
            <div className="mt-3 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((exam) => <ExamCard key={exam.id} exam={exam} />)}
            </div>
          </section>
        );
      })}
    </section>
  );
}
