"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { AccessLoading } from "@/components/auth/AccessGuard";
import { useAdminToast } from "@/components/admin/AdminToastProvider";
import {
  AutoEventCard,
  SentNotificationsList,
  cardClass,
  inputClass,
  labelClass,
  sectionTitleClass,
  type AdminNotification,
  type AutoEventMeta,
  type AutoSettingUI,
} from "@/components/admin/NotificationControlSections";

type Category = { id: string; name: string; isActive: boolean };
type Course = {
  slug: string;
  name: string;
  category?: string | null;
  categoryId?: string | null;
  status?: string;
};
type EnrolledStudent = {
  uid: string;
  name: string;
  email: string;
  studentId: string;
};

export default function EnrolledStudentsNotificationsPage() {
  const toast = useAdminToast();
  const { user, authLoading } = useAuth();
  const [events, setEvents] = useState<AutoEventMeta[]>([]);
  const [settings, setSettings] = useState<AutoSettingUI[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [enrolled, setEnrolled] = useState<EnrolledStudent[] | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [notifications, setNotifications] = useState<AdminNotification[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const authHeaders = useCallback(async () => {
    if (!user) throw new Error("Not signed in.");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    };
  }, [user]);

  const loadBase = useCallback(async () => {
    if (!user) return;
    try {
      const headers = await authHeaders();
      const auth = { Authorization: headers.Authorization };
      const [settingsRes, notificationsRes, categoriesRes, coursesRes] =
        await Promise.all([
          fetch("/api/admin/notification-settings", {
            headers: auth,
            cache: "no-store",
          }),
          fetch("/api/admin/notifications?all=1", {
            headers: auth,
            cache: "no-store",
          }),
          fetch("/api/admin/course-categories", {
            headers: auth,
            cache: "no-store",
          }),
          fetch("/api/admin/courses", { headers: auth, cache: "no-store" }),
        ]);
      if (settingsRes.ok) {
        const data = (await settingsRes.json()) as {
          events?: AutoEventMeta[];
          settings?: AutoSettingUI[];
        };
        setEvents(
          Array.isArray(data.events)
            ? data.events.filter((event) =>
                event.key.startsWith("auto_enrolled_"),
              )
            : [],
        );
        setSettings(Array.isArray(data.settings) ? data.settings : []);
      }
      if (notificationsRes.ok) {
        const data = (await notificationsRes.json()) as {
          notifications?: AdminNotification[];
        };
        const all = Array.isArray(data.notifications) ? data.notifications : [];
        // This page owns the ENROLLED scope only — never mixed with
        // all-student or specific-student rows.
        setNotifications(
          all.filter((item) => item.audience === "enrolled"),
        );
      }
      if (categoriesRes.ok) {
        const data = (await categoriesRes.json()) as {
          categories?: Category[];
        };
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      }
      if (coursesRes.ok) {
        const data = (await coursesRes.json()) as { courses?: Course[] };
        setCourses(Array.isArray(data.courses) ? data.courses : []);
      }
    } catch {
      // Lists keep their previous state on transient failures.
    }
  }, [user, authHeaders]);

  useEffect(() => {
    if (authLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBase();
  }, [authLoading, user, loadBase]);

  const loadEnrolled = useCallback(
    async (slug: string) => {
      if (!user || !slug) {
        setEnrolled(null);
        return;
      }
      try {
        const headers = await authHeaders();
        const res = await fetch(
          `/api/admin/notification-enrollments?courseId=${encodeURIComponent(slug)}`,
          {
            headers: { Authorization: headers.Authorization },
            cache: "no-store",
          },
        );
        if (!res.ok) {
          setEnrolled([]);
          return;
        }
        const data = (await res.json()) as {
          students?: EnrolledStudent[];
        };
        setEnrolled(Array.isArray(data.students) ? data.students : []);
      } catch {
        setEnrolled([]);
      }
    },
    [user, authHeaders],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEnrolled(courseId);
  }, [courseId, loadEnrolled]);

  async function handleSaveSetting(next: AutoSettingUI) {
    setSavingKey(next.key);
    try {
      const res = await fetch("/api/admin/notification-settings", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => null)) as {
        settings?: AutoSettingUI[];
        error?: string;
      };
      if (!res.ok) {
        toast.showToast("error", data?.error ?? "Failed to save.");
        return;
      }
      if (Array.isArray(data.settings)) setSettings(data.settings);
      toast.showToast("success", "Automatic notification updated.");
    } catch {
      toast.showToast("error", "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSweep() {
    setSweeping(true);
    try {
      const res = await fetch("/api/admin/notifications/sweep", {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => null)) as {
        fired?: number;
      };
      if (!res.ok) {
        toast.showToast("error", "Sweep failed.");
        return;
      }
      toast.showToast(
        "success",
        data.fired && data.fired > 0
          ? `Live check complete — ${data.fired} notification(s) sent.`
          : "Live check complete — no new live exams.",
      );
      await loadBase();
    } catch {
      toast.showToast("error", "Sweep failed.");
    } finally {
      setSweeping(false);
    }
  }

  async function handleSend() {
    if (!courseId) {
      toast.showToast("error", "Select a course first.");
      return;
    }
    if (title.trim().length < 2 || message.trim().length < 2) {
      toast.showToast("error", "Title and message are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          link: link.trim(),
          audience: "enrolled",
          targetCourseId: courseId,
          isActive: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; push?: { sent: number } | null };
      if (!res.ok) {
        toast.showToast("error", data?.error ?? "Failed to send.");
        return;
      }
      toast.showToast(
        "success",
        `Notification sent to students enrolled in the selected course (${enrolled?.length ?? 0}).${typeof data?.push?.sent === "number" ? ` Push → ${data.push.sent} devices.` : ""}`,
      );
      setTitle("");
      setMessage("");
      setLink("");
      await loadBase();
    } catch {
      toast.showToast("error", "Failed to send the notification.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(item: AdminNotification) {
    try {
      await fetch("/api/admin/notifications", {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
      });
      await loadBase();
    } catch {
      toast.showToast("error", "Failed to update.");
    }
  }

  async function handleDelete(item: AdminNotification) {
    try {
      await fetch("/api/admin/notifications", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ id: item.id }),
      });
      await loadBase();
      toast.showToast("success", "Notification removed.");
    } catch {
      toast.showToast("error", "Failed to remove.");
    }
  }

  if (authLoading) {
    return <AccessLoading label="Loading Enrolled Students notifications…" />;
  }

  const settingFor = (key: string) =>
    settings.find((item) => item.key === key) ?? {
      key,
      enabled: true,
      title: "",
      message: "",
    };

  const visibleCourses = categoryId
    ? courses.filter((course) => course.categoryId === categoryId)
    : courses;

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/admin/notification-control"
        className="text-xs font-bold text-primary-600 admin-dark:text-primary-400"
      >
        ← Notification Control
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold text-[#0b1e3a] admin-dark:text-white">
        Notification for Enrolled Students
      </h1>
      <p className="mt-1 text-sm text-slate-500 admin-dark:text-slate-400">
        Course-scoped notifications — students receive only their own
        course&apos;s alerts, never another course&apos;s.
      </p>

      {/* A. Automatic Notifications for Enrolled Students */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          A. Automatic Notifications for Enrolled Students
        </h2>
        <p className="mt-1 text-xs text-slate-500 admin-dark:text-slate-400">
          Triggered by real course events — new class, new course exam, exam
          going live, new material. Each event fires exactly once per course.
        </p>
        <div className="mt-4 grid gap-3">
          {events.map((meta) => (
            <AutoEventCard
              key={meta.key}
              meta={meta}
              setting={settingFor(meta.key)}
              busy={savingKey === meta.key}
              onSave={(next) => void handleSaveSetting(next)}
            />
          ))}
          {events.length === 0 && (
            <AccessLoading label="Loading automatic events…" />
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleSweep()}
          disabled={sweeping}
          className="mt-4 rounded-xl border border-ink/15 px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-ink/5 admin-dark:text-slate-300 disabled:opacity-50"
        >
          {sweeping ? "Checking…" : "Check live exams now"}
        </button>
      </div>

      {/* B. Manual Notifications for Enrolled Students */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          B. Manual Notifications for Enrolled Students
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Course Category</span>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setCourseId("");
              }}
              className={inputClass}
            >
              <option value="">All categories…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Course</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a course…</option>
              {visibleCourses.map((course) => (
                <option key={course.slug} value={course.slug}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {courseId && (
          <div className="mt-3 rounded-xl border border-ink/10 px-4 py-3">
            {enrolled === null ? (
              <AccessLoading label="Loading enrolled students…" />
            ) : enrolled.length === 0 ? (
              <p className="text-xs text-slate-500 admin-dark:text-slate-400">
                No actively enrolled students in this course.
              </p>
            ) : (
              <p className="text-xs font-bold text-[#0b1e3a] admin-dark:text-white">
                {enrolled.length} enrolled student{enrolled.length === 1 ? "" : "s"} will
                receive this notification:
                <span className="mt-1 block max-h-20 overflow-y-auto font-semibold text-slate-500 admin-dark:text-slate-400">
                  {enrolled.map((student) => student.name).join(", ")}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className={labelClass}>Notification Title</span>
            <input
              type="text"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Notification title…"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Notification Message</span>
            <textarea
              value={message}
              rows={3}
              maxLength={2000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write the notification message…"
              className={`${inputClass} resize-none`}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Link on tap (optional)</span>
            <input
              type="text"
              value={link}
              maxLength={1024}
              onChange={(event) => setLink(event.target.value)}
              placeholder="/courses/specialmedicalexambatch"
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy}
            className="w-fit rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary-900/40 transition hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send Notification"}
          </button>
        </div>
      </div>

      {/* Existing notifications in this scope */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className="text-lg font-bold text-[#0b1e3a] admin-dark:text-white">
          Enrolled Students Notifications
        </h2>
        {notifications === null ? (
          <AccessLoading label="Loading notifications…" />
        ) : (
          <SentNotificationsList
            items={notifications}
            emptyLabel="No enrolled-student notifications yet."
            onToggleActive={(item) => void handleToggleActive(item)}
            onDelete={(item) => void handleDelete(item)}
          />
        )}
      </div>
    </section>
  );
}
