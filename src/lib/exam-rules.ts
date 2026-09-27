import { ensureColumn, exec, query } from "@/lib/mysql";

/**
 * Admin-managed exam rules (Admin → Public Exam Control → Category → Exam →
 * Rules). Every rule belongs to one specific exam_id + lang — rules are never
 * shared between exams. New public exams are seeded with their template's
 * rule set in BOTH languages; admins can add / edit / delete / reorder
 * afterwards per language.
 */

export type ExamRuleLang = "bangla" | "english";

function normalizeRuleLang(value: unknown): ExamRuleLang {
  return String(value ?? "").toLowerCase().trim() === "english" ? "english" : "bangla";
}

export type ExamRule = {
  id: number | null;
  examId: string;
  lang: ExamRuleLang;
  title: string;
  text: string;
  sortOrder: number;
};

type ExamRuleRow = {
  id: number;
  exam_id: string;
  lang: string | null;
  rule_title: string | null;
  rule_text: string;
  sort_order: number;
};

let rulesTableReady: Promise<void> | null = null;
function ensureExamRulesTable(): Promise<void> {
  if (!rulesTableReady) {
    rulesTableReady = (async () => {
      await exec(
        `CREATE TABLE IF NOT EXISTS exam_rules (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          exam_id VARCHAR(64) NOT NULL,
          lang VARCHAR(16) NOT NULL DEFAULT 'bangla',
          rule_title VARCHAR(191) NOT NULL DEFAULT '',
          rule_text TEXT NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY exam_rules_exam_idx (exam_id, lang)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
      try {
        await ensureColumn("exam_rules", "lang", "`lang` VARCHAR(16) NOT NULL DEFAULT 'bangla'");
      } catch {
        // Best effort — fresh tables already have the column.
      }
    })().catch((error) => {
      rulesTableReady = null;
      throw error;
    });
  }
  return rulesTableReady;
}

function rowToRule(row: ExamRuleRow): ExamRule {
  return {
    id: row.id,
    examId: row.exam_id,
    lang: normalizeRuleLang(row.lang),
    title: row.rule_title ?? "",
    text: row.rule_text,
    sortOrder: row.sort_order ?? 0,
  };
}

/** All rules of ONE exam + language, ordered. Strictly scoped by exam_id. */
export async function fetchExamRules(examId: string, lang: ExamRuleLang = "bangla"): Promise<ExamRule[]> {
  try {
    await ensureExamRulesTable();
    const rows = await query<ExamRuleRow[]>(
      `SELECT id, exam_id, lang, rule_title, rule_text, sort_order
       FROM exam_rules WHERE exam_id = ? AND lang = ? ORDER BY sort_order ASC, id ASC`,
      [examId, normalizeRuleLang(lang)],
    );
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

export async function saveExamRule(input: Record<string, unknown>): Promise<ExamRule[]> {
  await ensureExamRulesTable();
  const examId = typeof input.examId === "string" ? input.examId.trim() : "";
  if (!/^[a-z0-9-]{2,64}$/.test(examId)) {
    throw new Error("A valid exam is required.");
  }
  const lang = normalizeRuleLang(input.lang);
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 191) : "";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new Error("Rule text is required.");

  const existingId = Number(input.id);
  if (Number.isInteger(existingId) && existingId > 0) {
    // Rule must stay inside its own exam + language — never move across exams.
    await exec(
      `UPDATE exam_rules SET rule_title = ?, rule_text = ? WHERE id = ? AND exam_id = ? AND lang = ?`,
      [title, text, existingId, examId, lang],
    );
    return fetchExamRules(examId, lang);
  }

  const maxRows = await query<{ m: number | null }[]>(
    `SELECT MAX(sort_order) AS m FROM exam_rules WHERE exam_id = ? AND lang = ?`,
    [examId, lang],
  );
  const nextOrder = (maxRows[0]?.m ?? 0) + 1;
  await exec(
    `INSERT INTO exam_rules (exam_id, lang, rule_title, rule_text, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [examId, lang, title, text, nextOrder],
  );
  return fetchExamRules(examId, lang);
}

export async function deleteExamRule(
  examId: string,
  id: number,
  lang: ExamRuleLang = "bangla",
): Promise<ExamRule[]> {
  await ensureExamRulesTable();
  await exec(`DELETE FROM exam_rules WHERE id = ? AND exam_id = ? AND lang = ?`, [id, examId, normalizeRuleLang(lang)]);
  return fetchExamRules(examId, lang);
}

/** Reorder rules within ONE exam + language from an ordered id list. */
export async function reorderExamRules(
  examId: string,
  orderedIds: number[],
  lang: ExamRuleLang = "bangla",
): Promise<ExamRule[]> {
  await ensureExamRulesTable();
  const key = normalizeRuleLang(lang);
  for (let index = 0; index < orderedIds.length; index += 1) {
    await exec(
      `UPDATE exam_rules SET sort_order = ? WHERE id = ? AND exam_id = ? AND lang = ?`,
      [index + 1, orderedIds[index], examId, key],
    );
  }
  return fetchExamRules(examId, key);
}

/** MediSpark's standard rule set for brand-new exams (editable afterwards).
 * Template- and language-aware: Academic / Medical / Varsity texts come from
 * the central Exam Rules page (exam_rule_template_items). Falls back to
 * built-ins. */
export function buildDefaultExamRules(examId: string, template?: string | null, lang?: ExamRuleLang | string | null): ExamRule[] {
  const key = String(template ?? "").toLowerCase() === "medical" ? "medical" : String(template ?? "").toLowerCase() === "university" || String(template ?? "").toLowerCase() === "varsity" ? "university" : "academic";
  const langKey = normalizeRuleLang(lang);
  if (langKey === "english") {
    const negative =
      key === "academic"
        ? "There is no negative marking in this exam — wrong answers cost nothing. Answer freely."
        : "Negative marking is enabled in this exam — 0.25 marks will be deducted for each wrong answer. Answer carefully!";
    const secondTimer =
      key === "medical"
        ? "If you take this exam a second time (Second Timer), extra marks will be deducted after grading. First Timer attempts are never penalised."
        : "There is no Second Timer penalty in this exam — retakes lose no extra marks.";
    const defaults: Array<Pick<ExamRule, "title" | "text">> = [
      { title: "Duration", text: "You will get the full exam duration. The countdown timer starts as soon as you begin the exam." },
      { title: "Marking System", text: "You will get full marks for each correct answer. Unanswered questions get zero." },
      { title: "Negative Marking", text: negative },
      { title: "Answer Selection Rules", text: "Select one option per question. Answers lock immediately after selection — you cannot change or clear them. You may answer in any order and return to skipped questions before submitting." },
      { title: "Submission Rules", text: "Answer all questions on the single scrollable paper, then click Submit Exam. Your result is calculated and shown instantly after submission." },
      { title: "Auto-Submit Rules", text: "When the timer reaches zero, the exam auto-submits your locked answers. If the tab is closed or you leave mid-exam, your already-locked answers are auto-submitted too. Starting the exam on another device ends this session and submits it automatically." },
      { title: "Second Attempt Timer Penalty", text: secondTimer },
      { title: "Answer Key", text: "Correct answers stay hidden during the exam. After submission you can open the answer script from your result card to compare." },
    ];
    return defaults.map((rule, index) => ({ id: null, examId, lang: langKey, title: rule.title, text: rule.text, sortOrder: index + 1 }));
  }
  const negative =
    key === "academic"
      ? "এই পরীক্ষায় নেগেটিভ মার্কিং নেই — ভুল উত্তরের জন্য কোনো নম্বর কাটা যাবে না। নিশ্চিন্তে উত্তর দিন।"
      : "এই পরীক্ষায় নেগেটিভ মার্কিং চালু থাকলে প্রতিটি ভুল উত্তরের জন্য ০.২৫ নম্বর কাটা যাবে। সতর্কভাবে উত্তর দিন!";
  const secondTimer =
    key === "medical"
      ? "এই পরীক্ষার জন্য চালু থাকলে, একই পরীক্ষা দ্বিতীয়বার (Second Timer) দিলে গ্রেডিংয়ের পর অতিরিক্ত নম্বর কাটা যাবে। প্রথমবারের (First Timer) প্রচেষ্টায় কখনো জরিমানা করা হয় না।"
      : "এই পরীক্ষায় Second Timer জরিমানা নেই — পুনরায় দিলেও অতিরিক্ত নম্বর কাটা যাবে না।";
  const defaults: Array<Pick<ExamRule, "title" | "text">> = [
    {
      title: "Duration",
      text: "আপনি পরীক্ষার পুরো সময় পাবেন। পরীক্ষা শুরু করার সাথে সাথেই কাউন্টডাউন টাইমার চালু হবে।",
    },
    {
      title: "Marking System",
      text: "প্রতিটি সঠিক উত্তরের জন্য প্রশ্নের পুরো নম্বর পাবেন। উত্তর না দিলে শূন্য নম্বর পাবেন।",
    },
    {
      title: "Negative Marking",
      text: negative,
    },
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
      text: "টাইমার শূন্যে পৌঁছালে পরীক্ষা স্বয়ংক্রিয়ভাবে আপনার লক করা উত্তরগুলো জমা দিয়ে দেবে। যদি পরীক্ষা চলাকালীন ট্যাব বন্ধ করেন বা পেজ ছেড়ে যান, তাহলে ইতিমধ্যে দেওয়া উত্তরগুলোও স্বয়ংক্রিয়ভাবে জমা হয়ে যাবে। অন্য ডিভাইসে একই পরীক্ষা শুরু করলে এই সেশনটি শেষ হয়ে স্বয়ংক্রিয়ভাবে জমা হয়ে যাবে।",
    },
    {
      title: "Second Attempt Timer Penalty",
      text: secondTimer,
    },
    {
      title: "Answer Key",
      text: "পরীক্ষা চলাকালীন সঠিক উত্তরগুলো লুকানো থাকবে। জমা দেওয়ার পর আপনি রেজাল্ট কার্ড থেকে উত্তরপত্র খুলে আপনার উত্তরগুলো সঠিক উত্তরের সাথে মিলিয়ে দেখতে পারবেন।",
    },
  ];
  return defaults.map((rule, index) => ({
    id: null,
    examId,
    lang: langKey,
    title: rule.title,
    text: rule.text,
    sortOrder: index + 1,
  }));
}

/** Seed the standard rules for a new exam (only when it has none yet).
 * Prefers the central Exam Rules template when available. Seeds BOTH
 * languages so Bangla- and English-version students each get rules. */
export async function seedDefaultExamRules(examId: string, template?: string | null): Promise<void> {
  await ensureExamRulesTable();
  const existing = await query<{ id: number }[]>(
    `SELECT id FROM exam_rules WHERE exam_id = ? LIMIT 1`,
    [examId],
  );
  if (existing.length > 0) return;
  // Prefer central template rows (Admin → Exam Rules page), per language.
  try {
    const { ensureTemplateTable, normalizeTemplate, normalizeLang } = await import("@/lib/exam-rule-templates");
    await ensureTemplateTable();
    const key = normalizeTemplate(template);
    let seeded = 0;
    for (const lang of ["bangla", "english"] as const) {
      const tplRows = await query<{ rule_title: string | null; rule_text: string; sort_order: number }[]>(
        `SELECT rule_title, rule_text, sort_order FROM exam_rule_template_items WHERE template = ? AND lang = ? ORDER BY sort_order ASC`,
        [key, normalizeLang(lang)],
      );
      const rows = tplRows.length > 0
        ? tplRows
        : buildDefaultExamRules(examId, template, lang).map((r) => ({ rule_title: r.title, rule_text: r.text, sort_order: r.sortOrder }));
      for (const r of rows) {
        await exec(
          `INSERT INTO exam_rules (exam_id, lang, rule_title, rule_text, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [examId, lang, r.rule_title ?? "", r.rule_text, r.sort_order],
        );
        seeded += 1;
      }
    }
    if (seeded > 0) return;
  } catch {
    // Fall through to built-ins.
  }
  for (const lang of ["bangla", "english"] as const) {
    const rules = buildDefaultExamRules(examId, template, lang);
    for (const rule of rules) {
      await exec(
        `INSERT INTO exam_rules (exam_id, lang, rule_title, rule_text, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [rule.examId, lang, rule.title, rule.text, rule.sortOrder],
      );
    }
  }
}
