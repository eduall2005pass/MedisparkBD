import type { EnrolledExamCardSettings } from "@/lib/enrolled-exam-card";

const paths: Record<EnrolledExamCardSettings["icon"], string> = {
  "clipboard-list": "M9 5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9V3Zm0 9h6m-6 4h6",
  "book-open": "M12 6v15m0-15C9 3 5 3 2 4v15c3-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-3-1-7-1-10 2",
  "graduation-cap": "m2 9 10-5 10 5-10 5L2 9Zm4 2v6c4 3 8 3 12 0v-6m4-2v8",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 11h2m4 0h2m-8 4h2",
};

export default function EnrolledExamCardIcon({ icon }: { icon: EnrolledExamCardSettings["icon"] }) {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={paths[icon]} />
    </svg>
  );
}
