"use client";

/**
 * Offline cache for participated / completed exams and their results.
 *
 * - Every successful fetch of completed exam IDs or a result script is
 *   mirrored to localStorage (namespaced per student uid).
 * - When the network is unavailable (or a fetch fails), views fall back to
 *   the cached copy so students can still see the results of exams they
 *   already participated in.
 * - When the network returns, views re-fetch and overwrite the cache, so
 *   online data is always shown dynamically.
 *
 * Only COMPLETED results are cached here — question papers are never cached
 * (exam integrity: no stale papers, ever).
 */

function keyFor(uid: string, suffix: string): string {
  return `medispark:offline:${uid}:${suffix}`;
}

function safeGet<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Offline fallback must never serve months-old data as if it were fresh.
 * Slow-network users see the cached snapshot while the live fetch is
 * pending — cap it at 7 days so a deleted exam/result eventually drops
 * out even when the network keeps failing.
 */
const OFFLINE_IDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Result scripts / merit lists go stale fast (deletion must propagate) — 24h max. */
const OFFLINE_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(cachedAt: unknown, ttlMs: number): boolean {
  return (
    typeof cachedAt === "number" &&
    Number.isFinite(cachedAt) &&
    Date.now() - cachedAt <= ttlMs
  );
}

function safeGetFresh<T extends { cachedAt?: unknown }>(key: string, ttlMs = OFFLINE_IDS_TTL_MS): T | null {
  const cached = safeGet<T>(key);
  if (!cached || !isFresh(cached.cachedAt, ttlMs)) {
    if (cached) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore cleanup failures.
      }
    }
    return null;
  }
  return cached;
}

/** Remove all offline snapshots for a student (call on logout). */
export function clearOfflineCache(uid: string): void {
  if (!uid || typeof window === "undefined") return;
  for (const suffix of ["completed-exam-ids", "my-exam-results"]) {
    try {
      window.localStorage.removeItem(keyFor(uid, suffix));
    } catch {
      // Ignore.
    }
  }
  try {
    const prefix = keyFor(uid, "exam-result:");
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore.
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private-mode failures must never break the UI.
  }
}

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// ---------- Completed / participated exam IDs ----------

type CompletedCache = { ids: string[]; cachedAt: number };

export function cacheCompletedExamIds(uid: string, ids: string[]): void {
  if (!uid) return;
  safeSet(keyFor(uid, "completed-exam-ids"), {
    ids,
    cachedAt: Date.now(),
  } satisfies CompletedCache);
}

export function getCachedCompletedExamIds(uid: string): string[] | null {
  if (!uid || typeof window === "undefined") return null;
  const cached = safeGetFresh<CompletedCache>(keyFor(uid, "completed-exam-ids"));
  return Array.isArray(cached?.ids) ? cached.ids : null;
}

// ---------- Single exam result script (generic — any result JSON) ----------

type ResultCache<T> = { script: T; cachedAt: number };

export function cacheExamResult<T>(uid: string, examId: string, script: T): void {
  if (!uid || !examId) return;
  safeSet(keyFor(uid, `exam-result:${examId}`), {
    script,
    cachedAt: Date.now(),
  } satisfies ResultCache<T>);
}

export function getCachedExamResult<T>(uid: string, examId: string): T | null {
  if (!uid || !examId || typeof window === "undefined") return null;
  const cached = safeGetFresh<ResultCache<T>>(keyFor(uid, `exam-result:${examId}`), OFFLINE_RESULT_TTL_MS);
  return cached?.script ?? null;
}

/** Drop one cached result (call when the server reports the exam deleted / inaccessible). */
export function removeCachedExamResult(uid: string, examId: string): void {
  if (!uid || !examId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(uid, `exam-result:${examId}`));
  } catch {
    // Ignore.
  }
}

/** Intersect cached completed IDs with the server-known valid set; prunes deleted exams. */
export function pruneCachedCompletedIds(uid: string, validIds: string[] | Set<string>): string[] | null {
  const cached = getCachedCompletedExamIds(uid);
  if (!cached) return null;
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  const pruned = cached.filter((id) => valid.has(id));
  if (pruned.length !== cached.length) cacheCompletedExamIds(uid, pruned);
  return pruned;
}

// ---------- Dashboard "my results" list ----------

type MyResultsCache<T> = { data: T; cachedAt: number };

export function cacheMyResults<T>(uid: string, data: T): void {
  if (!uid) return;
  safeSet(keyFor(uid, "my-exam-results"), {
    data,
    cachedAt: Date.now(),
  } satisfies MyResultsCache<T>);
}

export function getCachedMyResults<T>(uid: string): T | null {
  if (!uid || typeof window === "undefined") return null;
  const cached = safeGetFresh<MyResultsCache<T>>(keyFor(uid, "my-exam-results"), OFFLINE_RESULT_TTL_MS);
  return (cached?.data as T | undefined) ?? null;
}
