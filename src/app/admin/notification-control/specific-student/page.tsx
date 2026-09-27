"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type Student = {
  uid: string;
  studentId?: string;
  fullName?: string;
  name?: string;
  email?: string;
  profilePictureUrl?: string | null;
  createdAt?: number | null;
  isActive?: boolean;
};

export default function SpecificStudentNotificationsPage() {
  const toast = useAdminToast();
  const { user, authLoading } = useAuth();
  const [events, setEvents] = useState<AutoEventMeta[]>([]);
  const [settings, setSettings] = useState<AutoSettingUI[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [studentUid, setStudentUid] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [notifications, setNotifications] = useState<AdminNotification[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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
      const [settingsRes, notificationsRes, studentsRes] = await Promise.all([
        fetch("/api/admin/notification-settings", {
          headers: auth,
          cache: "no-store",
        }),
        fetch("/api/admin/notifications?all=1", {
          headers: auth,
          cache: "no-store",
        }),
        fetch("/api/admin/students?status=all", {
          headers: auth,
          cache: "no-store",
        }),
      ]);
      if (settingsRes.ok) {
        const data = (await settingsRes.json()) as {
          events?: AutoEventMeta[];
          settings?: AutoSettingUI[];
        };
        setEvents(
          Array.isArray(data.events)
            ? data.events.filter((event) =>
                event.key.startsWith("auto_specific_"),
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
        // This page owns the SPECIFIC scope only — never mixed with
        // all-student or enrolled rows.
        setNotifications(
          all.filter((item) => item.audience === "student"),
        );
      }
      if (studentsRes.ok) {
        const data = (await studentsRes.json()) as { students?: Student[] };
        setStudents(Array.isArray(data.students) ? data.students : []);
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

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return students.slice(0, 50);
    return students
      .filter((student) => {
        const haystack =
          `${student.fullName ?? ""} ${student.name ?? ""} ${student.email ?? ""} ${student.studentId ?? ""}`.toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 50);
  }, [students, search]);

  const selectedStudent =
    students.find((student) => student.uid === studentUid) ?? null;

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

  async function handleSend() {
    if (!selectedStudent) {
      toast.showToast("error", "Select a student first.");
      return;
    }
    if (title.trim().length < 2 || message.trim().length < 2) {
      toast.showToast("error", "Title and message are required.");
      return;
    }
    setBusy(true);
    try {
      const headers = await authHeaders();
      // 1) Persist to the student's inbox (audience "student" — visible
      //    ONLY to this student).
      const inboxRes = await fetch("/api/admin/notifications", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          link: link.trim(),
          audience: "student",
          targetUid: selectedStudent.uid,
          targetEmail: selectedStudent.email,
          isActive: true,
        }),
      });
      const inboxData = (await inboxRes.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!inboxRes.ok) {
        toast.showToast("error", inboxData?.error ?? "Failed to save.");
        return;
      }
      // 2) Best-effort web push to the student's registered devices.
      try {
        await fetch("/api/admin/push", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: title.trim(),
            body: message.trim(),
            url: link.trim(),
            audience: "specific",
            email: selectedStudent.email,
          }),
        });
      } catch {
        // Push is optional — the inbox notification is already stored.
      }
      toast.showToast(
        "success",
        `Notification sent to ${selectedStudent.fullName ?? selectedStudent.name ?? selectedStudent.email}.`,
      );
      setTitle("");
      setMessage("");
      setLink("");
      setStudentUid("");
      setSearch("");
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
    return <AccessLoading label="Loading Specific Student notifications…" />;
  }

  const settingFor = (key: string) =>
    settings.find((item) => item.key === key) ?? {
      key,
      enabled: true,
      title: "",
      message: "",
    };

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/admin/notification-control"
        className="text-xs font-bold text-primary-600 admin-dark:text-primary-400"
      >
        ← Notification Control
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold text-[#0b1e3a] admin-dark:text-white">
        Notification for a Specific Student
      </h1>
      <p className="mt-1 text-sm text-slate-500 admin-dark:text-slate-400">
        One student at a time — no other student ever receives these.
      </p>

      {/* A. Automatic Notifications for a Specific Student */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          A. Automatic Notifications for a Specific Student
        </h2>
        <p className="mt-1 text-xs text-slate-500 admin-dark:text-slate-400">
          Triggered by student-specific events — enrollment confirmation goes
          to the exact student of that event, nobody else.
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
      </div>

      {/* B. Manual Notifications for a Specific Student */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          B. Manual Notifications for a Specific Student
        </h2>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className={labelClass}>Search Student</span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or student ID…"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Select Student</span>
            <select
              value={studentUid}
              onChange={(event) => setStudentUid(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose a student…</option>
              {filteredStudents.map((student) => (
                <option key={student.uid} value={student.uid}>
                  {student.fullName || student.name}
                  {student.email ? ` (${student.email})` : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedStudent && (
            <div className="flex items-center gap-3 rounded-xl border border-ink/10 px-4 py-3">
              {selectedStudent.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedStudent.profilePictureUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-600/15 text-base font-extrabold text-primary-700 admin-dark:text-primary-300">
                  {(selectedStudent.fullName ??
                    selectedStudent.name ??
                    "?").charAt(0)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-[#0b1e3a] admin-dark:text-white">
                  {selectedStudent.fullName ?? selectedStudent.name}
                </p>
                <p className="truncate text-xs text-slate-500 admin-dark:text-slate-400">
                  {selectedStudent.email}
                  {selectedStudent.studentId
                    ? ` · ID: ${selectedStudent.studentId}`
                    : ""}
                  {selectedStudent.createdAt
                    ? ` · Joined ${new Date(selectedStudent.createdAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
            </div>
          )}

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
          Specific Student Notifications
        </h2>
        {notifications === null ? (
          <AccessLoading label="Loading notifications…" />
        ) : (
          <SentNotificationsList
            items={notifications}
            emptyLabel="No specific-student notifications yet."
            onToggleActive={(item) => void handleToggleActive(item)}
            onDelete={(item) => void handleDelete(item)}
          />
        )}
      </div>
    </section>
  );
}
