"use client";

import { useState } from "react";

/** Notification row as returned by GET /api/admin/notifications?all=1. */
export type AdminNotification = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  audience: string;
  targetUid?: string | null;
  targetEmail?: string | null;
  targetCourseId?: string | null;
  origin?: string | null;
  eventKey?: string | null;
  isActive: boolean;
  createdAt?: string;
};

export type AutoSettingUI = {
  key: string;
  enabled: boolean;
  title: string;
  message: string;
};

export type AutoEventMeta = {
  key: string;
  label: string;
  description: string;
  placeholders: string[];
};

export const cardClass =
  "rounded-2xl border border-[#dbeafe] bg-white shadow-sm shadow-[#0b1e3a]/5 admin-dark:border-[#1e3a65] admin-dark:bg-[#112544] p-6 shadow-lg shadow-black/20";

export const inputClass =
  "mt-1 w-full rounded-xl border border-ink/15 bg-[#f8fbff] admin-dark:bg-[#0f2547] px-3.5 py-2.5 text-sm text-[#0b1e3a] outline-none admin-dark:text-white focus:border-[#2f6bce]/60";

export const labelClass =
  "text-xs font-semibold text-slate-500 admin-dark:text-slate-400";

export const sectionTitleClass =
  "text-sm font-bold uppercase tracking-wide text-slate-500 admin-dark:text-slate-400";

/** One automatic event: enable toggle + editable title/message template. */
export function AutoEventCard({
  meta,
  setting,
  busy,
  onSave,
}: {
  meta: AutoEventMeta;
  setting: AutoSettingUI;
  busy: boolean;
  onSave: (next: AutoSettingUI) => void;
}) {
  const [enabled, setEnabled] = useState(setting.enabled);
  const [title, setTitle] = useState(setting.title);
  const [message, setMessage] = useState(setting.message);
  const dirty =
    enabled !== setting.enabled ||
    title !== setting.title ||
    message !== setting.message;

  return (
    <div className="rounded-xl border border-ink/10 bg-[#f8fbff] admin-dark:bg-[#0f2547]/60 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[#0b1e3a] admin-dark:text-white">
            {meta.label}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500 admin-dark:text-slate-400">
            {meta.description}
          </p>
          {meta.placeholders.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-400 admin-dark:text-slate-500">
              Placeholders: {meta.placeholders.join(" · ")}
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${meta.label} enabled`}
          onClick={() => setEnabled((value) => !value)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
            enabled ? "bg-primary-600" : "bg-slate-300 admin-dark:bg-slate-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        <label className="block">
          <span className={labelClass}>Title</span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Message</span>
          <textarea
            value={message}
            rows={2}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            className={`${inputClass} resize-none`}
          />
        </label>
        <div>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => onSave({ key: meta.key, enabled, title, message })}
            className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-primary-700 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sent-notification list with enable/disable + delete management. */
export function SentNotificationsList({
  items,
  emptyLabel,
  onToggleActive,
  onDelete,
}: {
  items: AdminNotification[];
  emptyLabel: string;
  onToggleActive: (item: AdminNotification) => void;
  onDelete: (item: AdminNotification) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-slate-500 admin-dark:text-slate-400">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {items.map((notification) => (
        <li
          key={notification.id}
          className="flex items-start gap-3 rounded-xl border border-ink/10 bg-[#f1f5f9] admin-dark:bg-[#0a162e]/60 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#0b1e3a] admin-dark:text-white">
              {notification.title}
              {!notification.isActive && (
                <span className="ml-2 rounded-md bg-slate-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                  Disabled
                </span>
              )}
            </p>
            <p className="line-clamp-2 text-xs text-slate-500 admin-dark:text-slate-400">
              {notification.message}
            </p>
            {notification.link && (
              <p className="truncate text-[11px] font-semibold text-primary-600 admin-dark:text-primary-400">
                🔗 {notification.link}
              </p>
            )}
            <span className="mt-1 inline-block rounded-md bg-ink/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 admin-dark:text-slate-400">
              {notification.origin === "automatic" ? "Automatic" : "Manual"}
              {" · "}
              {notification.audience}
              {notification.targetCourseId
                ? ` · ${notification.targetCourseId}`
                : ""}
              {notification.targetEmail ? ` · ${notification.targetEmail}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onToggleActive(notification)}
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-ink/5 admin-dark:text-slate-300"
            >
              {notification.isActive ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              onClick={() => onDelete(notification)}
              className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-500/15 admin-dark:text-red-400"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
