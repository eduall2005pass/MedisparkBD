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

export default function AllStudentsNotificationsPage() {
  const toast = useAdminToast();
  const { user, authLoading } = useAuth();
  const [events, setEvents] = useState<AutoEventMeta[]>([]);
  const [settings, setSettings] = useState<AutoSettingUI[]>([]);
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

  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
      const headers = await authHeaders();
      const [settingsRes, notificationsRes] = await Promise.all([
        fetch("/api/admin/notification-settings", {
          headers: { Authorization: headers.Authorization },
          cache: "no-store",
        }),
        fetch("/api/admin/notifications?all=1", {
          headers: { Authorization: headers.Authorization },
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
            ? data.events.filter((event) => event.key.startsWith("auto_all_"))
            : [],
        );
        setSettings(Array.isArray(data.settings) ? data.settings : []);
      }
      if (notificationsRes.ok) {
        const data = (await notificationsRes.json()) as {
          notifications?: AdminNotification[];
        };
        const all = Array.isArray(data.notifications) ? data.notifications : [];
        // This page owns the ALL scope only — enrolled / specific rows live
        // on their own dedicated pages and are never shown here.
        setNotifications(
          all.filter(
            (item) => item.audience === "all" || item.audience === "students",
          ),
        );
      }
    } catch {
      // Lists keep their previous state on transient failures.
    }
  }, [user, authHeaders]);

  useEffect(() => {
    if (authLoading || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [authLoading, user, loadAll]);

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
          audience: "all",
          isActive: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; push?: { sent: number } | null };
      if (!res.ok) {
        toast.showToast("error", data?.error ?? "Failed to send.");
        return;
      }
      toast.showToast("success", `Notification sent to all students.${typeof data?.push?.sent === "number" ? ` Push → ${data.push.sent} devices.` : ""}`);
      setTitle("");
      setMessage("");
      setLink("");
      await loadAll();
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
      await loadAll();
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
      await loadAll();
      toast.showToast("success", "Notification removed.");
    } catch {
      toast.showToast("error", "Failed to remove.");
    }
  }

  if (authLoading) {
    return <AccessLoading label="Loading All Students notifications…" />;
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
        Notification for All Students
      </h1>
      <p className="mt-1 text-sm text-slate-500 admin-dark:text-slate-400">
        Automatic event notifications and manual broadcasts for every student.
      </p>

      {/* A. Automatic Notifications for All Students */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          A. Automatic Notifications for All Students
        </h2>
        <p className="mt-1 text-xs text-slate-500 admin-dark:text-slate-400">
          Sent automatically by real system events — welcome on registration,
          new course published, new public exam published. Each event fires
          exactly once.
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

      {/* B. Manual Notifications for All Students */}
      <div className={`mt-6 ${cardClass}`}>
        <h2 className={sectionTitleClass}>
          B. Manual Notifications for All Students
        </h2>
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className={labelClass}>Notification Title</span>
            <input
              type="text"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Important MediSpark Update"
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
              placeholder="Your upcoming exam schedule has been updated. Please check the exam section."
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
          All Students Notifications
        </h2>
        {notifications === null ? (
          <AccessLoading label="Loading notifications…" />
        ) : (
          <SentNotificationsList
            items={notifications}
            emptyLabel="No all-student notifications yet."
            onToggleActive={(item) => void handleToggleActive(item)}
            onDelete={(item) => void handleDelete(item)}
          />
        )}
      </div>
    </section>
  );
}
