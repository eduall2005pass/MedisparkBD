import { ensureColumn, exec, query } from "@/lib/mysql";

/**
 * Central rule templates — Admin → Exam Rules page.
 * 3 fixed types: academic | medical | university (varsity).
 * Each template has TWO languages: bangla | english. Students see the rules
 * in their chosen question-version language while giving the exam.
 * Exam create only SELECTS one of these; the actual rule texts are edited
 * here. Per-exam rows in `exam_rules` remain as overrides.
 */

export const RULE_TEMPLATES = ["academic", "medical", "university"] as const;
export type RuleTemplateKey = (typeof RULE_TEMPLATES)[number];

export const RULE_LANGS = ["bangla", "english"] as const;
export type RuleLang = (typeof RULE_LANGS)[number];

export function normalizeLang(value: unknown): RuleLang {
  return String(value ?? "").toLowerCase().trim() === "english" ? "english" : "bangla";
}

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
  lang: RuleLang;
  title: string;
  text: string;
  sortOrder: number;
};

type TemplateRow = {
  id: number;
  template: string;
  lang: string | null;
  rule_title: string | null;
  rule_text: string;
  sort_order: number;
};

let tableReady: Promise<void> | null = null;
export function ensureTemplateTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await exec(
        `CREATE TABLE IF NOT EXISTS exam_rule_template_items (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          template VARCHAR(32) NOT NULL,
          lang VARCHAR(16) NOT NULL DEFAULT 'bangla',
          rule_title VARCHAR(191) NOT NULL DEFAULT '',
          rule_text TEXT NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY exam_rule_template_items_tpl_idx (template, lang)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      try {
        await ensureColumn("exam_rule_template_items", "lang", "`lang` VARCHAR(16) NOT NULL DEFAULT 'bangla'");
      } catch {
        // Best effort — fresh tables already have the column.
      }
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
    lang: normalizeLang(row.lang),
    title: row.rule_title ?? "",
    text: row.rule_text,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Hard-coded defaults per template + language — used until admin edits them. */
export function buildDefaultTemplateRules(
  template: RuleTemplateKey,
  lang: RuleLang = "bangla",
): Array<Pick<TemplateRule, "title" | "text">> {
  if (lang === "english") {
    const negative =
      template === "academic"
        ? "There is no negative marking in this exam — wrong answers cost nothing. Answer freely."
        : "Negative marking is enabled in this exam — 0.25 marks will be deducted for each wrong answer. Answer carefully!";
    const secondTimer =
      template === "medical"
        ? "If you take this exam a second time (Second Timer), 3 marks will be deducted after grading. First Timer attempts are never penalised."
        : "There is no Second Timer penalty in this exam — retakes lose no extra marks.";
    return [
      { title: "Duration", text: "You will get the full exam duration. The countdown timer starts as soon as you begin the exam." },
      { title: "Marking System", text: "You will get full marks for each correct answer. Unanswered questions get zero." },
      { title: "Negative Marking", text: negative },
      {
        title: "Answer Selection Rules",
        text: "Select one option per question. Answers lock immediately after selection — you cannot change or clear them. You may answer in any order and return to skipped questions before submitting.",
      },
      {
        title: "Submission Rules",
        text: "Answer all questions on the single scrollable paper, then click Submit Exam. Your result is calculated and shown instantly after submission.",
      },
      {
        title: "Auto-Submit Rules",
        text: "When the timer reaches zero, the exam auto-submits your locked answers. If the tab is closed or you leave mid-exam, your already-locked answers are auto-submitted too.",
      },
      { title: "Second Attempt Timer Penalty", text: secondTimer },
      {
        title: "Answer Key",
        text: "Correct answers stay hidden during the exam. After submission you can open the answer script from your result card to compare.",
      },
    ];
  }
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

export async function fetchTemplateRules(template: RuleTemplateKey, lang: RuleLang = "bangla"): Promise<TemplateRule[]> {
  try {
    await ensureTemplateTable();
    const rows = await query<TemplateRow[]>(
      `SELECT id, template, lang, rule_title, rule_text, sort_order FROM exam_rule_template_items WHERE template = ? AND lang = ? ORDER BY sort_order ASC, id ASC`,
      [template, lang],
    );
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

/** One-time import from the legacy exam_rule_templates.rules JSON column
 * (template_key → template). Returns true when anything was imported. */
async function importLegacyRules(template: RuleTemplateKey): Promise<boolean> {
  try {
    const rows = await query<{ rules: unknown }[]>(
      `SELECT rules FROM exam_rule_templates WHERE template_key = ? LIMIT 1`,
      [template],
    );
    const raw = rows[0]?.rules;
    if (!raw) return false;
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return false;
      }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const items: Array<{ title: string; text: string }> = [];
    for (const entry of parsed) {
      if (typeof entry === "string") {
        if (entry.trim()) items.push({ title: "", text: entry.trim() });
      } else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        const text = String(o.text ?? o.rule_text ?? o.detail ?? "").trim();
        if (!text) continue;
        items.push({ title: String(o.title ?? o.rule_title ?? "").trim().slice(0, 191), text });
      }
    }
    if (items.length === 0) return false;
    for (let i = 0; i < items.length; i += 1) {
      await exec(
        `INSERT INTO exam_rule_template_items (template, lang, rule_title, rule_text, sort_order) VALUES (?, 'bangla', ?, ?, ?)`,
        [template, items[i].title, items[i].text, i + 1],
      );
    }
    return true;
  } catch {
    return false; // legacy table/column missing — fall back to built-ins
  }
}

/** Seed one template+lang with defaults when it has no rows yet. Returns current rows. */
export async function seedTemplateIfEmpty(template: RuleTemplateKey, lang: RuleLang = "bangla"): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  const existing = await query<{ id: number }[]>(
    `SELECT id FROM exam_rule_template_items WHERE template = ? AND lang = ? LIMIT 1`,
    [template, lang],
  );
  if (existing.length === 0) {
    // Bangla first prefers existing rules from the legacy template table so
    // nothing the admin wrote before is lost; otherwise seed built-ins.
    const imported = lang === "bangla" ? await importLegacyRules(template) : false;
    if (!imported) {
      const defaults = buildDefaultTemplateRules(template, lang);
      for (let i = 0; i < defaults.length; i += 1) {
        await exec(
          `INSERT INTO exam_rule_template_items (template, lang, rule_title, rule_text, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [template, lang, defaults[i].title, defaults[i].text, i + 1],
        );
      }
    }
  }
  return fetchTemplateRules(template, lang);
}

export async function saveTemplateRule(input: Record<string, unknown>): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  const template = normalizeTemplate(input.template);
  const lang = normalizeLang(input.lang);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 191) : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new Error("Rule text is required.");
  const existingId = Number(input.id);
  if (Number.isInteger(existingId) && existingId > 0) {
    await exec(
      `UPDATE exam_rule_template_items SET rule_title = ?, rule_text = ? WHERE id = ? AND template = ? AND lang = ?`,
      [title, text, existingId, template, lang],
    );
    return fetchTemplateRules(template, lang);
  }
  const maxRows = await query<{ m: number | null }[]>(
    `SELECT MAX(sort_order) AS m FROM exam_rule_template_items WHERE template = ? AND lang = ?`,
    [template, lang],
  );
  const nextOrder = (maxRows[0]?.m ?? 0) + 1;
  await exec(
    `INSERT INTO exam_rule_template_items (template, lang, rule_title, rule_text, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [template, lang, title, text, nextOrder],
  );
  return fetchTemplateRules(template, lang);
}

export async function deleteTemplateRule(template: RuleTemplateKey, lang: RuleLang, id: number): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  await exec(`DELETE FROM exam_rule_template_items WHERE id = ? AND template = ? AND lang = ?`, [id, template, lang]);
  return fetchTemplateRules(template, lang);
}

export async function reorderTemplateRules(template: RuleTemplateKey, lang: RuleLang, orderedIds: number[]): Promise<TemplateRule[]> {
  await ensureTemplateTable();
  for (let i = 0; i < orderedIds.length; i += 1) {
    await exec(`UPDATE exam_rule_template_items SET sort_order = ? WHERE id = ? AND template = ? AND lang = ?`, [
      i + 1,
      orderedIds[i],
      template,
      lang,
    ]);
  }
  return fetchTemplateRules(template, lang);
}
