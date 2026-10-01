/**
 * Student direct-contact helpers (WhatsApp / Telegram deep links + vCard).
 *
 * BD numbers are stored in mixed formats ("01XXXXXXXXX", "+880…", "880…").
 * wa.me needs bare international digits, t.me/+ needs "+" + digits.
 */

const WA_TEXT = "Assalamu Alaikum, MediSpark BD theke bolchi.";

/** "01XXXXXXXXX" → "8801XXXXXXXXX". Returns null when unusable. */
export function toWaNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  // Strip trunk/prefix variants: "+880" stored as "00880…" etc.
  if (digits.startsWith("00880")) digits = digits.slice(2);
  if (digits.startsWith("880") && digits.length === 13) return digits;
  if (digits.startsWith("01") && digits.length === 11) return `880${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `880${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

/** Direct chat link, e.g. https://wa.me/8801XXXXXXXXX?text=… */
export function whatsappUrl(raw: string | null | undefined): string | null {
  const digits = toWaNumber(raw);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(WA_TEXT)}`;
}

/**
 * Direct Telegram chat link by phone — opens the chat when the number
 * has Telegram (https://t.me/+8801XXXXXXXXX).
 */
export function telegramUrl(raw: string | null | undefined): string | null {
  const digits = toWaNumber(raw);
  if (!digits) return null;
  return `https://t.me/+${digits}`;
}

/** Multi-contact vCard — import into Google Contacts / iPhone, Telegram syncs them. */
export function buildVCard(
  rows: Array<{ name: string; phone: string }>,
): string {
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, " ");
  return rows
    .map(
      (row) =>
        ["BEGIN:VCARD", "VERSION:3.0", `FN:${escape(row.name) || row.phone}`, `TEL;TYPE=CELL:${escape(row.phone)}`, "END:VCARD"].join("\n"),
    )
    .join("\n");
}
