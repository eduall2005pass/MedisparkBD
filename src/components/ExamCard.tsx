"use client";

import Link from "next/link";
import StartExamButton from "@/components/StartExamButton";
import { hasControlAccess, useAdminGate } from "@/components/admin/admin-ui";
import {
  type ExamStatus,
  type PublicExam,
} from "@/lib/public-exams";

/**
 * Exam Card — single premium design shared by ALL states.
 * Upcoming, Live and Practice render 100% IDENTICAL visuals (layout, size,
 * spacing, typography, shape, icon style, border style, radius, shadow,
 * hover effect, premium appearance, responsive behavior). The ONLY difference
 * is the state color + state-specific text/functionality:
 *
 *   Upcoming → YELLOW + "Upcoming Exam" + "Coming Soon" (disabled, cannot start)
 *   Live     → GREEN  + "Exam is Live Now" + "Start Exam" (blinking dot, starts live attempt)
 *   Practice → BLUE   + "Practice Exam" + "Start Exam" (unranked practice attempt)
 *
 * The bottom CTA button keeps the EXACT SAME premium structure in every state
 * (solid gradient, border width, white text, inset highlight, glow shadow,
 * hover lift, focus ring) — only the hue tokens change (yellow / emerald /
 * blue). Light + Dark Mode keep the SAME hue per state; theme-aware tweaks
 * (exam-btn-*, exam-pill-*, exam-accent-*) only tune contrast so each color
 * stays readable on both themes.
 *
 *   Upcoming → "Upcoming Exam" + "Coming Soon" (disabled, cannot start)
 *   Live     → "Exam is Live Now" + "Start Exam" (blinking dot, starts live attempt)
 *   Practice → "Practice Exam" + "Start Exam" (unranked practice attempt)
 *
 * Visual theme per state (same design, only hue changes):
 *   Upcoming → YELLOW / GOLD on a dark surface.
 *   Live     → EMERALD / GREEN (same structure, green tokens).
 *   Practice → BLUE (same structure, blue tokens).
 * Live keeps a faster dot blink as its state-specific indicator behavior —
 * same size/position, only the pulse speed differs.
 * No red chrome appears on Upcoming / Live / Practice cards.
 *
 * Single premium button design for ALL states (dark surface preserved): the
 * state accent (yellow / green / blue) extends through the entire card
 * (outer border, ambient glow, gradient wash, icons, CTA button) while the
 * main surface stays dark to blend with the MediSpark background.
 * Closed/expired states keep their own muted theme.
 *
 * Schedule visibility: the "পরীক্ষায় অংশগ্রহণের সময়সূচি" section renders
 * for ALL states (Upcoming / Live / Practice) — it is gated ONLY on the
 * presence of schedule data (scheduledAt / endsAt), NEVER on exam status.
 * A Live transition must never hide the schedule.
 *
 * Layout (premium, open, no boxed stats):
 *   Row 1: exam title (left) + compact status pill (right, same row)
 *   Row 2: open Marks + Duration info directly on the card surface (no boxes,
 *          no vertical divider)
 *   Row 3: schedule heading (calendar icon + Bengali title) + Start → End
 *          plain timing row (no pill boxes, no excessive borders)
 *   Row 4: one full-width premium bottom action button (no arrows)
 *
 * Theme-safe: every color goes through theme tokens (bg-dark-*, text-heading,
 * text-neutral-*, border-ink/*) so Dark + Light both stay readable. Yellow /
 * green / blue status accents are visible on both themes. No hardcoded
 * white-on-dark or black-on-light text.
 *
 * Responsive: same design on desktop / tablet / mobile — the card only shrinks
 * and wraps (title + pill stay on one row where space allows, never overflow).
 */

function formatDayMonth(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Dhaka",
  });
}

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Dhaka",
    })
    .toUpperCase();
}

function shouldShowTimeRow(exam: PublicExam): boolean {
  // Schedule visibility is data-driven ONLY — never gated on exam status.
  // Upcoming, Live and Practice all show the schedule when dates exist.
  return Boolean(exam.scheduledAt) || Boolean(exam.endsAt);
}

function ExamWindow({
  exam,
  accentText,
}: {
  exam: PublicExam;
  accentText: string;
}) {
  if (!shouldShowTimeRow(exam)) return null;
  return (
    <div className="mt-4 min-w-0">
      <p className="flex min-w-0 items-center gap-2 text-[13px] font-extrabold leading-snug text-heading">
        <span className={`shrink-0 ${accentText}`} aria-hidden="true">
          <CalendarIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 truncate">
          পরীক্ষায় অংশগ্রহণের সময়সূচি
        </span>
      </p>
      <div className="mt-2.5 flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">
            Start
          </p>
          <p className="mt-0.5 truncate text-[13px] font-extrabold leading-tight text-heading sm:text-sm">
            {formatDayMonth(exam.scheduledAt)}{" "}
            <span className="font-bold text-neutral-300">
              {formatClock(exam.scheduledAt)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center" aria-hidden="true">
          <span className={`text-base font-extrabold leading-none sm:text-lg ${accentText}`}>
            &rarr;
          </span>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">
            End
          </p>
          <p className="mt-0.5 truncate text-[13px] font-extrabold leading-tight text-heading sm:text-sm">
            {formatDayMonth(exam.endsAt)}{" "}
            <span className="font-bold text-neutral-300">
              {formatClock(exam.endsAt)}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

type CardPhase = "upcoming" | "live" | "practice" | "closed" | "idle";

function phaseOf(status: ExamStatus): CardPhase {
  if (status === "Upcoming") return "upcoming";
  if (status === "Live" || status === "Available") return "live";
  if (status === "Practice" || status === "Archived") return "practice";
  if (status === "Completed" || status === "Expired") return "closed";
  return "idle";
}

const phaseMeta: Record<
  CardPhase,
  {
    badge: string;
    dotClass: string;
    label: string;
    action: string;
    accentBar: string;
    ring: string;
    /** Status-tinted chrome: marks/duration chips + participation arrow. */
    icon: string;
    /** Plain status-tinted text color for open (box-free) icons + arrows. */
    accentText: string;
    /** Status-tinted divider gradient stop. */
    divider: string;
    /** Status-tinted top glow blob. */
    glow: string;
    /** Status-tinted CTA gradient (live + practice buttons). */
    btn: string;
    /** Full-card outer border tint for the phase. */
    cardBorder: string;
    /** Full-card ambient shadow/glow tint for the phase. */
    cardShadow: string;
    /** Full-card gradient wash (subtle, over the dark surface). */
    wash: string;
    /** Status-tinted inner panel: marks/duration box + schedule pills. */
    panel: string;
    /** Disabled CTA theme (Upcoming "Coming Soon" stays non-clickable). */
    disabledBtn: string;
  }
> = {
  upcoming: {
    badge: "Upcoming Exam",
    dotClass: "exam-dot exam-dot-upcoming",
    label: "border-yellow-400/50 bg-yellow-500/10 exam-pill-upcoming",
    action: "Coming Soon",
    accentBar: "from-yellow-500/80 via-yellow-500/20 to-transparent",
    ring: "hover:border-yellow-400/50",
    icon: "border-yellow-500/30 bg-yellow-600/10 exam-accent-upcoming",
    accentText: "exam-accent-upcoming",
    divider: "via-yellow-500/40",
    glow: "bg-yellow-600/10 group-hover:bg-yellow-600/20",
    btn: "exam-btn-upcoming border border-yellow-300/40 bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-600 text-white shadow-[0_12px_32px_-10px_rgba(234,179,8,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-yellow-200 hover:via-yellow-500 hover:to-yellow-600 hover:shadow-[0_16px_36px_-10px_rgba(234,179,8,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    cardBorder: "border-yellow-400/30",
    cardShadow: "shadow-yellow-950/30",
    wash: "from-yellow-500/[0.07] via-transparent to-transparent",
    panel: "border-yellow-500/20 bg-yellow-500/[0.05]",
    disabledBtn:
      "exam-btn-upcoming border border-yellow-300/40 bg-gradient-to-b from-yellow-300 via-yellow-500 to-yellow-600 text-white shadow-[0_12px_32px_-10px_rgba(234,179,8,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-yellow-200 hover:via-yellow-500 hover:to-yellow-600 hover:shadow-[0_16px_36px_-10px_rgba(234,179,8,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent cursor-not-allowed",
  },
  live: {
    badge: "Exam is Live Now",
    dotClass: "exam-dot exam-dot-live",
    label: "border-emerald-400/50 bg-emerald-500/10 exam-pill-live",
    action: "Start Exam",
    accentBar: "from-emerald-500/80 via-emerald-500/20 to-transparent",
    ring: "hover:border-emerald-400/50",
    icon: "border-emerald-500/30 bg-emerald-600/10 exam-accent-live",
    accentText: "exam-accent-live",
    divider: "via-emerald-500/40",
    glow: "bg-emerald-600/10 group-hover:bg-emerald-600/20",
    btn: "exam-btn-live border border-emerald-300/40 bg-gradient-to-b from-emerald-300 via-emerald-500 to-emerald-600 text-white shadow-[0_12px_32px_-10px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-emerald-200 hover:via-emerald-500 hover:to-emerald-600 hover:shadow-[0_16px_36px_-10px_rgba(16,185,129,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent cursor-pointer",
    cardBorder: "border-emerald-400/30",
    cardShadow: "shadow-emerald-950/30",
    wash: "from-emerald-500/[0.07] via-transparent to-transparent",
    panel: "border-emerald-500/20 bg-emerald-500/[0.05]",
    disabledBtn: "border-ink/10 bg-dark-850 text-neutral-400",
  },
  practice: {
    badge: "Practice Exam",
    dotClass: "exam-dot exam-dot-practice",
    label: "border-blue-400/50 bg-blue-500/10 exam-pill-practice",
    action: "Start Exam",
    accentBar: "from-blue-500/80 via-blue-500/20 to-transparent",
    ring: "hover:border-blue-400/50",
    icon: "border-blue-500/30 bg-blue-600/10 exam-accent-practice",
    accentText: "exam-accent-practice",
    divider: "via-blue-500/40",
    glow: "bg-blue-600/10 group-hover:bg-blue-600/20",
    btn: "exam-btn-practice border border-blue-300/40 bg-gradient-to-b from-blue-300 via-blue-500 to-blue-600 text-white shadow-[0_12px_32px_-10px_rgba(59,130,246,0.6),inset_0_1px_0_rgba(255,255,255,0.35)] hover:from-blue-200 hover:via-blue-500 hover:to-blue-600 hover:shadow-[0_16px_36px_-10px_rgba(59,130,246,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent cursor-pointer",
    cardBorder: "border-blue-400/30",
    cardShadow: "shadow-blue-950/30",
    wash: "from-blue-500/[0.07] via-transparent to-transparent",
    panel: "border-blue-500/20 bg-blue-500/[0.05]",
    disabledBtn: "border-ink/10 bg-dark-850 text-neutral-400",
  },
  closed: {
    badge: "Exam is Closed",
    dotClass: "exam-dot exam-dot-closed",
    label: "border-red-500/30 bg-red-500/10 text-red-500",
    action: "Exam is Closed",
    accentBar: "from-red-900/60 via-red-900/10 to-transparent",
    ring: "",
    icon: "border-red-500/30 bg-red-600/10 text-red-500",
    accentText: "text-red-500",
    divider: "via-red-500/40",
    glow: "bg-red-600/10 group-hover:bg-red-600/20",
    btn: "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-lg shadow-red-950/40 ring-1 ring-red-400/50 hover:from-red-400 hover:to-red-600",
    cardBorder: "border-ink/10",
    cardShadow: "",
    wash: "from-transparent via-transparent to-transparent",
    panel: "border-ink/10 bg-dark-850",
    disabledBtn: "border-ink/10 bg-dark-850 text-neutral-400",
  },
  idle: {
    badge: "Not Available",
    dotClass: "exam-dot exam-dot-closed",
    label: "border border-ink/10 bg-dark-800 text-neutral-500",
    action: "Not Available",
    accentBar: "from-neutral-700/40 via-neutral-700/10 to-transparent",
    ring: "",
    icon: "border-ink/10 bg-dark-800 text-neutral-500",
    accentText: "text-neutral-500",
    divider: "via-neutral-500/40",
    glow: "bg-primary-600/10 group-hover:bg-primary-600/20",
    btn: "border border-ink/10 bg-dark-800 text-neutral-400",
    cardBorder: "border-ink/10",
    cardShadow: "",
    wash: "from-transparent via-transparent to-transparent",
    panel: "border-ink/10 bg-dark-850",
    disabledBtn: "border-ink/10 bg-dark-850 text-neutral-400",
  },
};

function ClockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function MarksIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="9" r="5.25" />
      <path d="m12 6.7.96 1.95 2.15.31-1.56 1.52.37 2.14-1.92-1.01-1.92 1.01.37-2.14-1.56-1.52 2.15-.31L12 6.7z" />
      <path d="M9.2 13.4 7.5 20.5l4.5-2.3 4.5 2.3-1.7-7.1" />
    </svg>
  );
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3.5M16 3v3.5" />
    </svg>
  );
}

export default function ExamCard({
  exam,
  detailsHref,
  manage,
  hasCompleted,
}: {
  exam: PublicExam;
  detailsHref?: string;
  manage?: React.ReactNode;
  hasCompleted?: boolean;
}) {
  const phase = phaseOf(exam.status);
  const meta = phaseMeta[phase];
  const isUpcoming = phase === "upcoming";
  const isPractice = phase === "practice";
  const isClosed = phase === "closed";
  // Practice (post-live AND static practice-mode) stays startable even with a
  // prior attempt — each new attempt is an unranked practice attempt.
  const isPostLivePractice = isPractice && exam.examMode === "live";
  const gate = useAdminGate();
  const isResultAdmin =
    gate.ready && hasControlAccess(gate.role, gate.permissions, "/admin/result-control");
  const showSubmitted = hasCompleted && !isPractice;
  const showResultLink = showSubmitted && isResultAdmin;
  const canStart =
    !showSubmitted &&
    !isUpcoming &&
    !isClosed &&
    phase !== "idle";
  const href = detailsHref ?? `/exam/${exam.id}`;

  // State-tinted accent (yellow / green / blue) — same size/position/usage in
  // every state, only the hue changes. Theme-aware via exam-accent-* classes.
  const accentText = meta.accentText;

  const buttonBase =
    "w-full rounded-2xl px-6 py-3.5 text-[15px] font-extrabold tracking-wide touch-manipulation select-none transform-gpu will-change-transform transition-all duration-200 ease-out active:scale-[0.98]";

  return (
    <article
      className={`group relative flex min-w-0 w-full max-w-full flex-col overflow-hidden rounded-2xl border bg-dark-900 shadow-xl transition duration-150 ease-out hover:-translate-y-1 active:scale-[0.99] ${meta.cardBorder} ${meta.cardShadow} ${meta.ring} hover:shadow-2xl`}
    >
      {/* Top accent bar + theme-safe glow */}
      <div
        className={`h-1 w-full bg-gradient-to-r ${meta.accentBar}`}
        aria-hidden="true"
      />
      <div
        className={`pointer-events-none absolute -top-20 left-1/2 h-44 w-72 max-w-full -translate-x-1/2 rounded-full blur-3xl transition duration-300 ${meta.glow}`}
        aria-hidden="true"
      />
      {/* Full-card state wash — subtle tint over the dark surface */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${meta.wash}`}
        aria-hidden="true"
      />

      <div className="relative flex min-w-0 flex-1 flex-col p-4 sm:p-5">
        {/* Row 1 — title (left) + compact status pill (right, same row) */}
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 break-words text-[15px] font-extrabold leading-snug text-heading transition-colors duration-150 sm:text-[17px]">
            {exam.name}
          </h3>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] sm:text-[11px] ${meta.label}`}
          >
            <span className={meta.dotClass} aria-hidden="true" />
            {meta.badge}
          </span>
        </div>

        {/* Marks + Duration — open info directly on the card surface (no boxes, no divider) */}
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`shrink-0 ${accentText}`} aria-hidden="true">
              <MarksIcon />
            </span>
            <p className="truncate text-sm font-extrabold text-heading">
              {exam.totalMarks ?? "—"}
              <span className="ml-1.5 text-xs font-bold text-neutral-400">
                Marks
              </span>
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className={`shrink-0 ${accentText}`} aria-hidden="true">
              <ClockIcon className="h-[18px] w-[18px]" />
            </span>
            <p className="truncate text-sm font-extrabold text-heading">
              {exam.durationMinutes ?? "—"}
              <span className="ml-1.5 text-xs font-bold text-neutral-400">
                Min
              </span>
            </p>
          </div>
        </div>

        {/* Divider */}
        <div
          className={`mx-1 mt-4 h-px bg-gradient-to-r from-transparent to-transparent ${meta.divider}`}
          aria-hidden="true"
        />

        {/* Schedule window — always visible for Upcoming / Live / Practice (data-gated only) */}
        <ExamWindow exam={exam} accentText={accentText} />

        {isPostLivePractice && (
          <p className="exam-practice-note mt-3 rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-[11px] font-semibold leading-relaxed">
            Live window ended — practice attempts won&apos;t affect the
            leaderboard.
          </p>
        )}

        {/* Bottom action button — one full-width premium button, no arrows */}
        <div className="mt-auto min-w-0 pt-6">
          {showResultLink ? (
            <Link
              href={`/exam/${exam.id}/result`}
              className={`${buttonBase} exam-result-btn flex items-center justify-center border border-emerald-500/50 bg-emerald-600/15`}
            >
              View Result
            </Link>
          ) : showSubmitted ? (
            <div
              className={`${buttonBase} flex cursor-not-allowed items-center justify-center border border-emerald-500/50 bg-emerald-600/15`}
              aria-disabled="true"
            >
              Submitted ✓
            </div>
          ) : isUpcoming || isClosed || phase === "idle" ? (
            <div
              className={`${buttonBase} flex cursor-not-allowed items-center justify-center ${meta.disabledBtn}`}
              aria-disabled="true"
            >
              {meta.action}
            </div>
          ) : canStart && !detailsHref ? (
            <StartExamButton
              exam={exam}
              className={`${buttonBase} flex items-center justify-center ${meta.btn}`}
            >
              {meta.action}
            </StartExamButton>
          ) : (
            <Link
              href={href}
              className={`${buttonBase} flex items-center justify-center ${meta.btn}`}
            >
              {meta.action}
            </Link>
          )}

          {manage}
        </div>
      </div>
    </article>
  );
}
