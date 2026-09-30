// ── Unified chapter content ordering (Classes · Exams · Materials) ──────
// Manual cross-type ordering inside ONE chapter.
//
// Data model (existing architecture — no new tables):
//   - course_classes.sort_order   (per chapter)
//   - course_materials.sort_order (per chapter)
//   - exams.sort_order            (per chapter, via chapter_id)
// A unified save assigns positions 1..N across ALL THREE tables, so the
// merged admin list (and every student list, which already ORDERs BY
// sort_order) reflects one manual sequence, e.g.
//   1. Class → 2. Material → 3. Exam → 4. Class → 5. Material
//
// Reordering touches ONLY the sort_order column — titles, descriptions,
// questions, files and every other content field are never modified.
// Serial numbers shown in the UI are derived (position in the sorted list),
// so deleting an item can never leave broken serials.
// New items are appended at the end via nextUnifiedPosition().

import { ensureColumn, query, withTransaction } from "@/lib/mysql";

export type UnifiedItemKind = "class" | "material" | "exam";

export type UnifiedContentItem = {
  kind: UnifiedItemKind;
  /** String form of the id (materials use a numeric AUTO_INCREMENT id). */
  id: string;
  title: string;
  subtitle: string;
  sortOrder: number;
};

export type UnifiedOrderEntry = { kind: UnifiedItemKind; id: string };

const KINDS: UnifiedItemKind[] = ["class", "material", "exam"];

function asKind(value: unknown): UnifiedItemKind | null {
  return value === "class" || value === "material" || value === "exam"
    ? value
    : null;
}

/** Best-effort schema self-heal — old databases may miss a sort_order column. */
export async function ensureOrderSchema(): Promise<void> {
  try {
    await ensureColumn("course_classes", "sort_order", "`sort_order` INT NOT NULL DEFAULT 0");
  } catch {
    // Column already exists or no permission — reads/writes fall back below.
  }
  try {
    await ensureColumn("course_materials", "sort_order", "`sort_order` INT NOT NULL DEFAULT 0");
  } catch {
    // Same as above.
  }
  try {
    await ensureColumn("exams", "sort_order", "`sort_order` INT NOT NULL DEFAULT 0 AFTER chapter_id");
  } catch {
    // Same as above.
  }
}

/**
 * Pure merge + sort — deterministic across refreshes.
 * Items with sort_order <= 0 (legacy rows never manually ordered) sort
 * AFTER explicitly ordered items, keeping a stable (kind, id) tiebreak.
 * Serial = index + 1 of the returned array.
 */
export function mergeAndSortUnified(
  items: Array<{ kind: UnifiedItemKind; id: string; title: string; subtitle: string; sortOrder: number }>,
): UnifiedContentItem[] {
  const withKey = items.map((item) => ({
    item,
    effective: item.sortOrder > 0 ? item.sortOrder : Number.MAX_SAFE_INTEGER,
  }));
  withKey.sort((a, b) => {
    if (a.effective !== b.effective) return a.effective - b.effective;
    if (a.item.kind !== b.item.kind) return a.item.kind < b.item.kind ? -1 : 1;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return withKey.map(({ item }) => ({
    kind: item.kind,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    sortOrder: item.sortOrder,
  }));
}

type ClassOrderRow = { id: string; title: string; sort_order: number | null };
type MaterialOrderRow = {
  id: number | string;
  title: string;
  material_type: string | null;
  sort_order: number | null;
};
type ExamOrderRow = { id: string; title: string; sort_order: number | null };

/**
 * Every orderable item of one chapter, merged across content types and
 * sorted in manual display order. Only published exams are included —
 * exactly what students (and the admin learning tree) can see.
 */
export async function getChapterUnifiedItems(
  chapterId: string,
): Promise<UnifiedContentItem[]> {
  const id = chapterId.trim();
  if (!id) return [];
  await ensureOrderSchema();

  const [classes, materials, exams] = await Promise.all([
    query<ClassOrderRow[]>(
      `SELECT id, title, sort_order FROM course_classes WHERE chapter_id = ? AND is_active = 1`,
      [id],
    ).catch(() => [] as ClassOrderRow[]),
    query<MaterialOrderRow[]>(
      `SELECT id, title, material_type, sort_order FROM course_materials WHERE chapter_id = ? AND is_active = 1`,
      [id],
    ).catch(() => [] as MaterialOrderRow[]),
    query<ExamOrderRow[]>(
      `SELECT id, title, sort_order FROM exams WHERE chapter_id = ? AND status = 'published'`,
      [id],
    ).catch(() => [] as ExamOrderRow[]),
  ]);

  return mergeAndSortUnified([
    ...classes.map((c) => ({
      kind: "class" as const,
      id: String(c.id),
      title: c.title ?? "",
      subtitle: "Class",
      sortOrder: Number(c.sort_order ?? 0) || 0,
    })),
    ...materials.map((m) => ({
      kind: "material" as const,
      id: String(m.id),
      title: m.title ?? "",
      subtitle: materialLabel(m.material_type),
      sortOrder: Number(m.sort_order ?? 0) || 0,
    })),
    ...exams.map((e) => ({
      kind: "exam" as const,
      id: String(e.id),
      title: e.title ?? "",
      subtitle: "Exam",
      sortOrder: Number(e.sort_order ?? 0) || 0,
    })),
  ]);
}

function materialLabel(raw: string | null): string {
  const v = (raw ?? "").toLowerCase();
  if (v === "pdf") return "PDF";
  if (v === "slide") return "Slide";
  if (v === "note") return "Note";
  if (v === "link") return "Link";
  return "Material";
}

/**
 * Next free position at the END of a chapter's unified sequence
 * (MAX across all three content tables + 1). Used when new content is
 * created so it automatically appears last without disturbing the
 * admin-arranged order.
 */
export async function nextUnifiedPosition(chapterId: string): Promise<number> {
  const id = chapterId.trim();
  if (!id) return 1;
  const maxima = await Promise.all([
    query<{ m: number | string | null }[]>(
      `SELECT MAX(sort_order) AS m FROM course_classes WHERE chapter_id = ?`,
      [id],
    )
      .then((r) => Number(r[0]?.m ?? 0) || 0)
      .catch(() => 0),
    query<{ m: number | string | null }[]>(
      `SELECT MAX(sort_order) AS m FROM course_materials WHERE chapter_id = ?`,
      [id],
    )
      .then((r) => Number(r[0]?.m ?? 0) || 0)
      .catch(() => 0),
    query<{ m: number | string | null }[]>(
      `SELECT MAX(sort_order) AS m FROM exams WHERE chapter_id = ?`,
      [id],
    )
      .then((r) => Number(r[0]?.m ?? 0) || 0)
      .catch(() => 0),
  ]);
  return Math.max(0, ...maxima) + 1;
}

function entryKey(entry: UnifiedOrderEntry): string {
  return `${entry.kind}:${entry.id}`;
}

/**
 * Persist a full manual order. Positions 1..N are written into the
 * sort_order column of each item's own table — NO other column is touched.
 *
 * Requires the exact current item set (prevents a stale tab from silently
 * dropping newly added content). Throws on mismatch so the UI can reload.
 */
export async function saveChapterUnifiedOrder(
  chapterId: string,
  ordered: UnifiedOrderEntry[],
): Promise<UnifiedContentItem[]> {
  const id = chapterId.trim();
  if (!id) throw new Error("A chapter must be selected.");
  const clean: UnifiedOrderEntry[] = [];
  const seen = new Set<string>();
  for (const raw of ordered) {
    const kind = asKind((raw as { kind?: unknown })?.kind);
    const itemId =
      typeof (raw as { id?: unknown })?.id === "string" ||
      typeof (raw as { id?: unknown })?.id === "number"
        ? String((raw as { id?: unknown }).id).trim()
        : "";
    if (!kind || !itemId) throw new Error("Invalid order entry.");
    const key = `${kind}:${itemId}`;
    if (seen.has(key)) throw new Error("Duplicate item in order.");
    seen.add(key);
    clean.push({ kind, id: itemId });
  }
  if (clean.length === 0) throw new Error("No order provided.");

  await ensureOrderSchema();
  const current = await getChapterUnifiedItems(id);
  const currentKeys = new Set(current.map((c) => entryKey(c)));
  const incomingKeys = new Set(clean.map(entryKey));
  if (
    currentKeys.size !== incomingKeys.size ||
    [...currentKeys].some((k) => !incomingKeys.has(k))
  ) {
    throw new Error(
      "Order is out of date — content changed. Reload and try again.",
    );
  }

  // Only sort_order is ever written; content data stays untouched.
  // One transaction: N sequential UPDATEs succeed or roll back together.
  await withTransaction(async (conn) => {
    let position = 1;
    for (const entry of clean) {
      if (entry.kind === "class") {
        await conn.query(`UPDATE course_classes SET sort_order = ? WHERE id = ? AND chapter_id = ?`, [
          position,
          entry.id,
          id,
        ]);
      } else if (entry.kind === "material") {
        await conn.query(`UPDATE course_materials SET sort_order = ? WHERE id = ? AND chapter_id = ?`, [
          position,
          Number(entry.id),
          id,
        ]);
      } else {
        await conn.query(`UPDATE exams SET sort_order = ? WHERE id = ? AND chapter_id = ?`, [
          position,
          entry.id,
          id,
        ]);
      }
      position += 1;
    }
  });

  return getChapterUnifiedItems(id);
}

/** Validate/normalize a raw order payload from the API boundary. */
export function normalizeOrderPayload(value: unknown): UnifiedOrderEntry[] {
  if (!Array.isArray(value)) throw new Error("Invalid order — expected a list.");
  return value.map((raw) => {
    const kind = asKind((raw as { kind?: unknown })?.kind);
    const itemId = (raw as { id?: unknown })?.id;
    if (!kind || (typeof itemId !== "string" && typeof itemId !== "number") || !String(itemId).trim()) {
      throw new Error("Invalid order entry.");
    }
    return { kind, id: String(itemId).trim() };
  });
}

export { KINDS as UNIFIED_KINDS };
