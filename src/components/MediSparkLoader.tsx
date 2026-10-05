"use client";

import { useEffect, useState } from "react";

type LoaderSize = "small" | "medium" | "large";

type MediSparkLoaderProps = {
  size?: LoaderSize;
  fullscreen?: boolean;
  label?: string;
  className?: string;
  /** Show MediSpark BD branding text (default true for fullscreen, false for inline) */
  withBranding?: boolean;
  showDots?: boolean;
  /**
   * Real loading progress (0–100). Drives both the progress ring and the
   * center percentage so they stay perfectly synchronized.
   * When omitted, the loader runs a lifecycle-synced simulated progress
   * (eases toward 90% while mounted) rendered from the same state —
   * never a fake fixed value like 50%.
   */
  progress?: number | null;
};

const sizeMap: Record<LoaderSize, { container: number; percentText: string }> = {
  small: { container: 48, percentText: "text-[11px]" },
  medium: { container: 72, percentText: "text-sm" },
  large: { container: 92, percentText: "text-xl" },
};

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Lifecycle-synced progress: uses the explicit value when provided,
 * otherwise eases toward 90% while the loader is mounted (same easing
 * curve as the global top progress bar). The ring and the percentage
 * both render from this single state, so they can never drift apart.
 */
function useLoaderProgress(external: number | null | undefined): number {
  const [simulated, setSimulated] = useState(() =>
    external == null ? 6 : clampProgress(external),
  );
  useEffect(() => {
    if (external != null) return;
    const id = window.setInterval(() => {
      setSimulated((prev) => {
        if (prev >= 90) return 90;
        const remaining = 90 - prev;
        return Math.min(90, prev + Math.max(0.5, remaining * 0.07));
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [external]);
  return external == null ? simulated : clampProgress(external);
}

function LoaderCore({
  size = "medium",
  label,
  withBranding,
  showDots = true,
  progress: progressProp,
}: Pick<MediSparkLoaderProps, "size" | "label" | "withBranding" | "showDots" | "progress">) {
  const cfg = sizeMap[size ?? "medium"];
  const showBranding = withBranding ?? false;
  const progress = useLoaderProgress(progressProp);
  const percent = Math.round(progress);
  // SVG ring geometry (viewBox 100): track + progress arc.
  const RADIUS = 44;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset = CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative flex items-center justify-center"
        style={{ width: cfg.container, height: cfg.container }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`Loading ${percent} percent`}
      >
        {/* subtle track ring */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            className="stroke-white/10"
          />
          {/* progress arc: MediSpark red, driven by the same state as the percentage */}
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="stroke-primary-600"
            style={{ transition: "stroke-dashoffset 150ms linear" }}
          />
        </svg>
        <span className="absolute inset-[10px] rounded-full bg-white/5 backdrop-blur" />
        {/* center percentage — perfectly centered, big and readable */}
        <span
          className={`relative font-extrabold tabular-nums text-heading ${cfg.percentText}`}
          aria-hidden="true"
        >
          {percent}%
        </span>
      </div>

      {showBranding && (
        <>
          <p className="mt-5 text-sm font-extrabold tracking-tight text-heading">
            MediSpark <span className="font-semibold text-primary-400">BD</span>
          </p>
          <p className="mt-1 text-xs font-medium tracking-wide text-neutral-400">
            Together we Achieve Dream
          </p>
        </>
      )}

      {label ? (
        <p className="mt-3 text-sm text-neutral-400 text-center max-w-xs">
          {label}
        </p>
      ) : null}

      {showDots && (
        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-600 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-600 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-600" />
        </div>
      )}
    </div>
  );
}

export default function MediSparkLoader({
  size = "medium",
  fullscreen = false,
  label,
  className = "",
  withBranding,
  showDots,
  progress,
}: MediSparkLoaderProps) {
  const content = (
    <LoaderCore size={size} label={label} withBranding={withBranding ?? fullscreen} showDots={showDots} progress={progress} />
  );

  if (fullscreen) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={label ?? "Loading MediSpark"}
        className={`fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-dark-950 px-6 ${className}`}
      >
        {/* subtle glows - lightweight, no images */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-24 left-1/2 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-primary-600/10 blur-[70px]" />
          <div className="absolute bottom-[-80px] right-[-60px] h-[360px] w-[360px] rounded-full bg-primary-900/25 blur-[60px]" />
        </div>
        <div className="relative">{content}</div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label ?? "Loading"}
      className={`flex w-full items-center justify-center px-4 py-10 ${className}`}
    >
      {content}
    </div>
  );
}

// Aliases for spec requirement
export const GlobalLoader = MediSparkLoader;
export const MediSparkFullScreenLoader = (props: Omit<MediSparkLoaderProps, "fullscreen">) => (
  <MediSparkLoader {...props} fullscreen />
);

// Inline small variant helper for tables/cards
export function MediSparkInlineLoader({ label }: { label?: string }) {
  return <MediSparkLoader size="small" label={label} showDots={false} />;
}
