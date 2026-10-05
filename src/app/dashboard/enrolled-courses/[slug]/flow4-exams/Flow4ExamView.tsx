"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PermissionGate from "@/components/auth/PermissionGate";
import { useAuth } from "@/lib/auth-context";
import {
  getFlow4ExamLink,
  selectFlow4ExamSubjects,
  type EnrolledExamCourse,
  type Flow4ExamSubject,
} from "@/lib/enrolled-exams";

export default function Flow4ExamView({ slug }: { slug: string }) {
  return (
    <PermissionGate requirement="course" courseSlug={slug} loadingLabel="Loading exams...">
      <Flow4ExamContent slug={slug} />
    </PermissionGate>
  );
}

function Flow4ExamContent({ slug }: { slug: string }) {
  const { user, authLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [subjects, setSubjects] = useState<Flow4ExamSubject[]>([]);
  const [courseName, setCourseName] = useState("");
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
        const options = {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store" as const,
          signal: controller.signal,
        };
        // Revalidate ownership, visibility and the raw layout before opening a
        // bookmarked shortcut. A changed layout uses the backend's latest URL.
        const enrollmentResponse = await fetch("/api/my/enrolled-exams", options);
        if (!enrollmentResponse.ok) throw new Error("Could not verify your course access.");
        const enrollmentData = (await enrollmentResponse.json()) as { enrolled_courses: EnrolledExamCourse[] };
        const course = enrollmentData.enrolled_courses.find((item) => item.course_id === slug);
        if (!course) throw new Error("This course is unavailable or you are no longer actively enrolled.");
        if (controller.signal.aborted) return;
        if (course.direct_exam_route_url !== pathname) {
          router.replace(course.direct_exam_route_url);
          return;
        }
        const response = await fetch(`/api/my/flow4?course=${encodeURIComponent(slug)}&direct=1`, options);
        if (!response.ok) throw new Error("Could not load your course exams.");
        const data = (await response.json()) as { subjects?: Flow4ExamSubject[] };
        if (controller.signal.aborted) return;
        setSubjects(selectFlow4ExamSubjects(Array.isArray(data.subjects) ? data.subjects : []));
        setCourseName(course.course_name);
        setState("ready");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSubjects([]);
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
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary-500">{courseName}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading sm:text-3xl">Course Exams</h1>
        <p className="mt-1 text-sm text-neutral-400">Exams and quizzes, grouped by subject.</p>
      </header>
      {subjects.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-dark-900/60 p-10 text-center">
          <p className="font-semibold text-heading">No Exams Available</p>
          <p className="mt-1 text-sm text-neutral-400">This course has no available exams yet. Please check back later.</p>
        </div>
      ) : subjects.map((subject) => (
        <section key={subject.id} className="mt-8" aria-label={subject.name}>
          <h2 className="text-lg font-extrabold text-heading">{subject.name}</h2>
          <ul className="mt-3 space-y-3">
            {subject.contents.map((content) => {
              const link = getFlow4ExamLink(content);
              const linkClass = "rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700";
              return (
                <li key={content.id} className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-dark-900 p-4 shadow-lg shadow-black/20">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-heading">{content.title}</span>
                    <span className="text-xs text-neutral-500">{content.contentType}{content.durationMinutes > 0 ? ` · ${content.durationMinutes} min` : ""}</span>
                  </span>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>{link.label}</a>
                  ) : (
                    <Link href={link.href} className={linkClass}>{link.label}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
