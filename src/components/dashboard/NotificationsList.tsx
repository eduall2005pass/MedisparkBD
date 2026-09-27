"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type Notification = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  audience: "all" | "students" | "admins" | "enrolled" | "student";
  isRead: boolean;
  createdAt: string;
};

/** e.g. "18 September 2026 • 10:30 AM" */
function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();
  const time = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
  return `${day} ${month} ${year} • ${time}`;
}

/** Tell the header indicator the fresh unread count (same tab, instant). */
function broadcastUnreadCount(unreadCount: number): void {
  try {
    window.dispatchEvent(
      new CustomEvent("medispark:notifications-read", {
        detail: { unreadCount },
      }),
    );
  } catch {
    // Non-fatal — the header also polls + refetches on focus.
  }
}

export default function NotificationsList() {
  const { user } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load notifications.");
        const data = (await response.json()) as {
          notifications?: Notification[];
          unreadCount?: unknown;
        };
        if (cancelled) return;
        const items = Array.isArray(data.notifications) ? data.notifications : [];
        setNotifications(items);
        broadcastUnreadCount(
          typeof data.unreadCount === "number"
            ? data.unreadCount
            : items.filter((item) => !item.isRead).length,
        );
      } catch {
        if (!cancelled) {
          setNotifications([]);
          setError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const markRead = useCallback(
    async (id: string) => {
      if (!user || markingId) return;
      const current = notifications?.find((item) => item.id === id);
      if (!current || current.isRead) return;
      setMarkingId(id);
      // Optimistic: flip immediately, reconcile with the server count after.
      setNotifications((prev) =>
        prev?.map((item) => (item.id === id ? { ...item, isRead: true } : item)) ?? prev,
      );
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/notifications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id }),
        });
        const data = (await response.json().catch(() => null)) as {
          unreadCount?: unknown;
        } | null;
        if (!response.ok) throw new Error("Failed to mark as read.");
        broadcastUnreadCount(Number(data?.unreadCount ?? 0) || 0);
      } catch {
        // Roll back the optimistic flip so the indicator never lies.
        setNotifications((prev) =>
          prev?.map((item) => (item.id === id ? { ...item, isRead: false } : item)) ?? prev,
        );
      } finally {
        setMarkingId(null);
      }
    },
    [user, markingId, notifications],
  );

  const openNotification = useCallback(
    (item: Notification) => {
      if (!item.isRead) void markRead(item.id);
      // Click-through: relative links route in-app, absolute https URLs
      // (e.g. https://medisparkbd.com/courses/...) open directly.
      if (item.link) {
        if (item.link.startsWith("/")) router.push(item.link);
        else window.location.href = item.link;
      }
    },
    [markRead, router],
  );

  const markAllRead = useCallback(async () => {
    if (!user || markingAll) return;
    setMarkingAll(true);
    const previous = notifications;
    setNotifications((prev) => prev?.map((item) => ({ ...item, isRead: true })) ?? prev);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ all: true }),
      });
      const data = (await response.json().catch(() => null)) as {
        unreadCount?: unknown;
      } | null;
      if (!response.ok) throw new Error("Failed to mark all as read.");
      broadcastUnreadCount(Number(data?.unreadCount ?? 0) || 0);
    } catch {
      if (previous) setNotifications(previous);
    } finally {
      setMarkingAll(false);
    }
  }, [user, markingAll, notifications]);

  const unreadCount = notifications?.filter((item) => !item.isRead).length ?? 0;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      {notifications === null ? (
        <div className="mt-8 space-y-3" aria-label="Loading notifications">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-2xl border border-ink/10 bg-dark-900/60"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-dark-900/60 p-12 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-600/15 text-primary-500">
            <svg
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          </span>
          <p className="mt-5 font-semibold text-heading">No notifications yet</p>
          {error && (
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
              We could not load your notifications right now. Please try again later.
            </p>
          )}
        </div>
      ) : (
        <>
          {unreadCount > 0 && (
            <div className="mt-8 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                {unreadCount} unread
              </p>
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={markingAll}
                className="rounded-xl border border-ink/10 bg-ink/5 px-4 py-2 text-xs font-bold text-neutral-300 transition hover:border-primary-500/50 hover:bg-primary-500/10 hover:text-heading disabled:opacity-50"
              >
                {markingAll ? "Marking…" : "Mark all as read"}
              </button>
            </div>
          )}
          <ul className="mt-4 space-y-4">
            {notifications.map((notification) => {
              const clickable = !notification.isRead || Boolean(notification.link);
              return (
              <li key={notification.id}>
                <article
                  onClick={() => void openNotification(notification)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openNotification(notification);
                    }
                  }}
                  tabIndex={clickable ? 0 : -1}
                  role={clickable ? "button" : undefined}
                  aria-label={
                    notification.link
                      ? `Open: ${notification.title}`
                      : notification.isRead
                        ? notification.title
                        : `Mark as read: ${notification.title}`
                  }
                  className={`rounded-2xl border bg-dark-900 p-6 shadow-lg shadow-black/20 transition duration-300 hover:border-primary-600/60 hover:shadow-primary-900/30 sm:p-7 ${
                    notification.isRead && !notification.link
                      ? "border-ink/10"
                      : "cursor-pointer border-primary-500/40 bg-primary-600/[0.04]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {!notification.isRead && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold leading-snug text-heading">
                        {notification.title}
                      </h2>
                      <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
                        {notification.message}
                      </p>
                      {notification.link && (
                        <p className="mt-2 inline-flex items-center gap-1 rounded-lg border border-primary-500/40 bg-primary-600/10 px-2.5 py-1 text-[11px] font-extrabold text-primary-300">
                          Tap to open →
                        </p>
                      )}
                      <time
                        className="mt-3 block text-xs font-semibold text-neutral-500"
                        dateTime={notification.createdAt}
                      >
                        {formatDateTime(notification.createdAt)}
                      </time>
                    </div>
                  </div>
                </article>
              </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
