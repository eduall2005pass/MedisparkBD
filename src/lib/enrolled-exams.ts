import type { Flow4DirectContent } from "@/lib/flow4";

export type EnrolledExamCourse = {
  course_id: string;
  course_name: string;
  banner_image_url: string;
  direct_exam_route_url: string;
};

/** Use the raw catalog layout: my-learning's normalization conflates flow-4 and flow-5. */
export function resolveDirectExamRoute(
  courseId: string,
  contentLayout: string | null | undefined,
): string {
  const base = `/dashboard/enrolled-courses/${encodeURIComponent(courseId)}`;
  switch (contentLayout?.trim().toLowerCase()) {
    case "flow-5":
      return `${base}/exam-flow`;
    case "flow-4":
      return `${base}/flow4-exams`;
    default:
      // Include direct exam assignments as well as the legacy chapter hierarchy.
      return `${base}/course-exams`;
  }
}

export type Flow4ExamContent = Pick<
  Flow4DirectContent,
  "id" | "title" | "contentType" | "videoUrl" | "fileUrl" | "durationMinutes"
>;

export type Flow4ExamSubject = {
  id: string;
  name: string;
  contents: Flow4ExamContent[];
};

export function selectFlow4ExamSubjects(subjects: Flow4ExamSubject[]): Flow4ExamSubject[] {
  return subjects
    .map((subject) => ({
      ...subject,
      contents: subject.contents.filter((content) => {
        const type = content.contentType.trim().toLowerCase();
        return type === "exam" || type === "quiz";
      }),
    }))
    .filter((subject) => subject.contents.length > 0);
}

/** Preserve Flow4Student's link precedence, including externally hosted exams. */
export function getFlow4ExamLink(content: Flow4ExamContent): {
  href: string;
  label: "Watch" | "Open" | "Start";
  external: boolean;
} {
  if (content.videoUrl) return { href: content.videoUrl, label: "Watch", external: true };
  if (content.fileUrl) return { href: content.fileUrl, label: "Open", external: true };
  return { href: `/exam/${encodeURIComponent(content.id)}/rules`, label: "Start", external: false };
}
