"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useVisibleInterval } from "@/lib/use-visible-interval";

/**
 * Compact auto-update pill — sits beside filter dropdowns (exam category
 * pages). Revalidates the server view on an interval + manual refresh.
 * Wraps gracefully on mobile (parent should use flex-wrap).
 */
export default function AutoUpdateBar({
  intervalLabel = "১০ মিনিট পর পর",
  refreshMs = 10 * 60 * 1000,
  onRefresh,
}: {
  intervalLabel?: string;
  refreshMs?: number;
  onRefresh?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
      else router.refresh();
      setLastUpdated(new Date());
    } catch {
      // Keep old data + timestamp on failure.
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, router]);

  useEffect(() => {
    setLastUpdated(new Date());
  }, []);

  // Visible tabs only — background tabs cost zero invocations.
  useVisibleInterval(doRefresh, refreshMs);

  return (
    <div className="flex max-w-full items-center gap-2 rounded-full border border-primary-500/25 bg-primary-600/10 py-1.5 pl-3 pr-1.5">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <p className="truncate text-[11px] font-semibold text-neutral-300">
        {refreshing ? (
          <span className="text-emerald-400">আপডেট হচ্ছে…</span>
        ) : (
          <>
            অটো-আপডেট{" "}
            <span className="font-bold text-emerald-400">{intervalLabel}</span>
            {lastUpdated && (
              <span className="hidden font-normal text-neutral-500 min-[400px]:inline">
                {" "}
                · সর্বশেষ:{" "}
                {lastUpdated.toLocaleTimeString("en-GB", {
                  timeZone: "Asia/Dhaka",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => void doRefresh()}
        disabled={refreshing}
        title="এখনই রিফ্রেশ"
        aria-label="এখনই রিফ্রেশ"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/5 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 hover:text-primary-400 disabled:opacity-50"
      >
        <span className={refreshing ? "animate-spin" : ""}>⟳</span>
      </button>
    </div>
  );
}
