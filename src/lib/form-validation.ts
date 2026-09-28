/**
 * Shared form validation — dependency-free (no database, no Firebase, no
 * Next.js imports) so it can be safely imported from server code, client
 * components, and `node --test` regression tests. Do NOT add server-only
 * imports here.
 *
 * Canonical formats enforced across every form:
 *  - BD mobile: `+8801XXXXXXXXX` (operator digit 3–9)
 *  - Email: basic RFC-style `local@domain.tld`
 *  - URL: absolute http(s) or site-internal path
 */

// ── Bangladesh mobile ──────────────────────────────────────────────────────
// Canonical form: +8801XXXXXXXXX (e.g. +8801712345678).
export const BD_PHONE_CANONICAL_RE = /^\+8801[3-9]\d{8}$/;

export const BD_PHONE_MESSAGE =
  "Enter a valid mobile number (e.g. +8801712345678).";

const BN_DIGIT_MAP: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/**
 * Normalize any common BD mobile writing into canonical `+8801XXXXXXXXX`:
 * accepts `01XXXXXXXXX`, `8801XXXXXXXXX`, `+8801XXXXXXXXX`, with optional
 * spaces / dashes / parentheses, and Bangla digits. Returns null when the
 * digits do not form a valid BD mobile number.
 */
export function normalizeBdPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let digits = value.replace(/[০-৯]/g, (ch) => BN_DIGIT_MAP[ch] ?? ch);
  // Keep a leading + only; strip spaces, dashes, dots, parentheses.
  digits = digits.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = "+" + digits.slice(1).replace(/\+/g, "");
  else digits = digits.replace(/\+/g, "");
  let core: string;
  if (/^\+8801[3-9]\d{8}$/.test(digits)) return digits;
  if (/^8801[3-9]\d{8}$/.test(digits)) core = digits.slice(3);
  else if (/^01[3-9]\d{8}$/.test(digits)) core = digits.slice(1);
  else return null;
  return `+880${core}`;
}

/** Strict check for the canonical `+8801XXXXXXXXX` form. */
export function isValidBdPhone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return BD_PHONE_CANONICAL_RE.test(value.trim());
}

// ── Email ──────────────────────────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const EMAIL_MESSAGE = "Enter a valid email address.";

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length > 0 && v.length <= 254 && EMAIL_RE.test(v);
}

// ── URL ────────────────────────────────────────────────────────────────────
export const URL_MESSAGE =
  "Enter a valid URL starting with https:// (or a site path like /contact).";

/** Absolute http(s) URL or site-internal path (/contact). Max 2000 chars. */
export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 2000) return false;
  if (v.startsWith("/") && !v.startsWith("//")) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Normalize a pasted link: trim, and prepend `https://` when the user typed
 * a bare domain like `facebook.com/xyz`. Returns "" for empty input, or
 * null when the value cannot be salvaged into a valid URL.
 */
export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v === "") return "";
  if (isValidHttpUrl(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) {
    const withProto = `https://${v}`;
    if (isValidHttpUrl(withProto)) return withProto;
  }
  return null;
}

// ── Text ───────────────────────────────────────────────────────────────────
/** Trimmed text within [min, max] chars; null otherwise. */
export function cleanText(
  value: unknown,
  min: number,
  max: number,
): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ");
  if (v.length < min || v.length > max) return null;
  return v;
}

/** Optional text ("" → null), capped at max chars. */
export function cleanOptionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (v === "") return null;
  return v.slice(0, max);
}

// ── Numbers ────────────────────────────────────────────────────────────────
/** Finite number within [min, max]; null otherwise. */
export function toNumberInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Integer within [min, max]; null otherwise. */
export function toIntInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ── Field-specific formats ─────────────────────────────────────────────────
/** bKash/Nagad transaction ID: 4–64 chars, letters/digits/dash/underscore. */
export const TXN_ID_RE = /^[A-Za-z0-9\-_]{4,64}$/;
export const TXN_ID_MESSAGE =
  "Transaction ID is required (4–64 characters, letters/digits only).";

export function isValidTxnId(value: unknown): value is string {
  return typeof value === "string" && TXN_ID_RE.test(value.trim());
}

/** Coupon code: 2–32 chars, uppercase letters/digits/dash/underscore. */
export const COUPON_CODE_RE = /^[A-Z0-9\-_]{2,32}$/;

export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase().replace(/\s+/g, "");
  return COUPON_CODE_RE.test(v) ? v : null;
}

/** URL slug: lowercase letters/digits/dashes, 2–120 chars. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length >= 2 && v.length <= 120 && SLUG_RE.test(v);
}

/** Hex color (#fff / #ffffff). */
export function isValidHexColor(value: unknown): boolean {
  return (
    typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
  );
}

/** datetime-local input value (YYYY-MM-DDTHH:mm). */
export function isValidDateTimeLocal(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(v).getTime());
}

/** Full name: letters (EN/BN), spaces, dots, apostrophes, dashes — 2–100. */
export function isValidPersonName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim().replace(/\s+/g, " ");
  return (
    v.length >= 2 &&
    v.length <= 100 &&
    /^[A-Za-z\u0980-\u09FF .'\-()]+$/.test(v)
  );
}
