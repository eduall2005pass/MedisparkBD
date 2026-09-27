import { exec, query } from "@/lib/mysql";

/**
 * Central rule templates — Admin → Exam Rules page.
 * 3 fixed types: academic | medical | university (varsity).
 * Exam create only SELECTS one of these; the actual rule texts are edited
 * here. Per-exam rows in `exam_rules` remain as overrides.
 */

export const RULE_TEMPLATES = ["academic", "medical", "university"] as const;
export type RuleTemplateKey = (typeof RULE_TEMPLATES)[number];

export function normalizeTemplate(value: unknown): RuleTemplateKey {
  const v = String(value ?? "").toLowerCase().trim();
  if (v === "medical") return "medical";
  if (v === "university" || v === "varsity") return "university";
  return "academic";
}

export function templateLabel(template: RuleTemplateKey): string {
  if (template === "medical") return "Medical";
  if (template === "university") return "Varsity";
  return "Academic";
}

export type TemplateRule = {
  id: number | null;
  template: RuleTemplateKey;
  title: string;
  text: string;
  sortOrder: number;
};

type TemplateRow = {
  id: number;
  template: string;
  rule_title: string | null;
  rule_text: string;
  sort_order: number;
};

let tableReady: Promise<void> | null = null;
export function ensureTemplateTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await exec(
        `CREATE TABLE IF NOT EXISTS exam_rule_templates (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          template VARCHAR(32) NOT NULL,
          rule_title VARCHAR(191) NOT NULL DEFAULT '',
          rule_text TEXT NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY exam_rule_templates_tpl_idx (template)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

function rowToRule(row: TemplateRow): TemplateRule {
  return {
    id: row.id,
    template: normalizeTemplate(row.template),
    title: row.rule_title ?? "",
    text: row.rule_text,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Hard-coded defaults per template — used until admin edits them. */
export function buildDefaultTemplateRules(template: RuleTemplateKey): Array<Pick<TemplateRule, "title" | "text">> {
  const negative =
    template === "academic"
      ? "এই পরীক্ষায় নেগেটিভ মার্কিং নেই — ভুল উত্তরের জন্য কোনো নম্বর কাটা যাবে না। নিশ্চিন্তে উত্তর দিন।"
      : "এই পরীক্ষায় নেগেটিভ মার্কিং চালু আছে — প্রতিটি ভুল উত্তরের জন্য ০.২৫ নম্বর কাটা যাবে। সতর্কভাবে উত্তর দিন!";
  const secondTimer =
    template === "medical"
      ? "এই পরীক্ষা দ্বিতীয়বার (Second Timer) দিলে গ্রেডিংয়ের পর ৩ নম্বর কেটে নেওয়া হবে। প্রথমবারের (First Timer) প্রচেষ্টায় কখনো জরিমানা করা হয় না।"
      : "এই পরীক্ষায় Second Timer জরিমানা নেই — পুনরায় দিলেও অতিরিক্ত নম্বর কাটা যাবে না।";
  return [
    {
      title: "Duration",
      text: "আপনি পরীক্ষার পুরো সময় পাবেন। পরীক্ষা শুরু করার সাথে সাথেই কাউন্টডাউন টাইমার চালু হবে।",
    },
    {
      title: "Marking System",
      text: "প্রতিটি সঠিক উত্তরের জন্য প্রশ্নের পুরো নম্বর পাবেন। উত্তর না দিলে শূন্য নম্বর পাবেন।",
    },
    { title: "Negative Marking", text: negative },
    {
      title: "Answer Selection Rules",
      text: "প্রতিটি প্রশ্নের জন্য একটি অপশন নির্বাচন করুন। উত্তর নির্বাচন করার সাথে সাথেই তা লক হয়ে যাবে — পরিবর্তন বা মুছে ফেলা যাবে না। আপনি যেকোনো ক্রমে প্রশ্নের উত্তর দিতে পারবেন এবং জমা দেওয়ার আগে বাদ পড়া প্রশ্নে ফিরে যেতে পারবেন।",
    },
    {
      title: "Submission Rules",
      text: "একটি স্ক্রলযোগ্য প্রশ্নপত্রে সব প্রশ্নের উত্তর দিন, তারপর Submit Exam এ ক্লিক করুন। জমা দেওয়ার সাথে সাথেই আপনার ফলাফল হিসাব করে দেখানো হবে।",
    },
    {
      title: "Auto-Submit Rules",
      text: "টাইমার শূন্যে পৌঁছালে পরীক্ষা স্বয়ংক্রিয়ভাবে আপনার লক করা উত্তরগুলো জমা দিয়ে দেবে। যদি পরীক্ষা চলাকালীন ট্যাব বন্ধ করেন বা পেজ ছেড়ে যান, তাহলে ইতিমধ্যে দেওয়া উত্তরগুলোও স্বয়ংক্রিয়ভাবে জমা হয়ে যাবে।",
    },
    { title: "Second Attempt Timer Penalty", text: secondTimer },
    {
      title: "Answer Key",
      text: "পরীক্ষা চলাকালীন সঠিক উত্তরগুলো লুকানো থাকবে। জমা দেওয়ার পর আপনি রেজাল্ট কার্ড থেকে উত্তরপত্র খুলে আপনার উত্তরগুলো সঠিক উত্তরের সাথে মিলিয়ে দেখতে পারবেন।",
    },
  ];
}

export async function fetchTemplateRules(template: RuleTemplateKey): Promise<TemplateRule[]> {
  try {
    await ensureTemplateTable();
    const rows = await query<TemplateRow[]>(
      `SELECT id, template, rule_title, rule_text, sort_order FROM exam_rule_templates WHERE template = ? ORDER BY sort_order ASC, id ASC`,
      [template],
    );
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

/** Seed one template with defaults when it has no rows yet. Returns current rows. */
export async function seedTemplateIfEmpty(template: RuleTemplateKey): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  const existing = await query<{ id: number }[]>(
    `SELECT id FROM exam_rule_templates WHERE template = ? LIMIT 1`,
    [template],
  );
  if (existing.length === 0) {
    const defaults = buildDefaultTemplateRules(template);
    for (let i = 0; i < defaults.length; i += 1) {
      await exec(
        `INSERT INTO exam_rule_templates (template, rule_title, rule_text, sort_order) VALUES (?, ?, ?, ?)`,
        [template, defaults[i].title, defaults[i].text, i + 1],
      );
    }
  }
  return fetchTemplateRules(template);
}

export async function saveTemplateRule(input: Record<string, unknown>): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  const template = normalizeTemplate(input.template);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 191) : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new Error("Rule text is required.");
  const existingId = Number(input.id);
  if (Number.isInteger(existingId) && existingId > 0) {
    await exec(
      `UPDATE exam_rule_templates SET rule_title = ?, rule_text = ? WHERE id = ? AND template = ?`,
      [title, text, existingId, template],
    );
    return fetchTemplateRules(template);
  }
  const maxRows = await query<{ m: number | null }[]>(
    `SELECT MAX(sort_order) AS m FROM exam_rule_templates WHERE template = ?`,
    [template],
  );
  const nextOrder = (maxRows[0]?.m ?? 0) + 1;
  await exec(
    `INSERT INTO exam_rule_templates (template, rule_title, rule_text, sort_order) VALUES (?, ?, ?, ?)`,
    [template, title, text, nextOrder],
  );
  return fetchTemplateRules(template);
}

export async function deleteTemplateRule(template: RuleTemplateKey, id: number): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  await exec(`DELETE FROM exam_rule_templates WHERE id = ? AND template = ?`, [id, template]);
  return fetchTemplateRules(template);
}

export async function reorderTemplateRules(template: RuleTemplateKey, orderedIds: number[]): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  for (let i = 0; i < orderedIds.length; i += 1) {
    await exec(`UPDATE exam_rule_templates SET sort_order = ? WHERE id = ? AND template = ?`, [
      i + 1,
      orderedIds[i],
      template,
    ]);
  }
  return fetchTemplateRules(template);
}
