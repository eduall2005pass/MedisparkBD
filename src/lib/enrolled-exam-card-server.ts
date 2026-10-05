import { exec, query } from "@/lib/mysql";
import {
  DEFAULT_ENROLLED_EXAM_CARD,
  ENROLLED_EXAM_CARD_KEY,
  validateEnrolledExamCard,
  type EnrolledExamCardSettings,
} from "@/lib/enrolled-exam-card";

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = exec(`CREATE TABLE IF NOT EXISTS global_settings (
      setting_key VARCHAR(191) NOT NULL PRIMARY KEY,
      setting_value JSON NOT NULL,
      updated_by VARCHAR(191) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      .then(() => undefined)
      .catch((error: unknown) => {
        tableReady = null;
        throw error;
      });
  }
  return tableReady;
}

export async function fetchEnrolledExamCard(): Promise<EnrolledExamCardSettings> {
  // Prefer the migration in deployments with no DDL privileges. Only create
  // lazily if the table is missing; outages must not re-enable a hidden card.
  let rows: { setting_value: unknown }[];
  const select = () => query<{ setting_value: unknown }[]>(
    "SELECT setting_value FROM global_settings WHERE setting_key = ? LIMIT 1",
    [ENROLLED_EXAM_CARD_KEY],
    { cache: false },
  );
  try {
    rows = await select();
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw error;
    await ensureTable();
    rows = await select();
  }
  if (!rows[0]) return { ...DEFAULT_ENROLLED_EXAM_CARD };
  const value = rows[0].setting_value;
  return validateEnrolledExamCard(typeof value === "string" ? JSON.parse(value) : value);
}

export async function saveEnrolledExamCard(
  input: unknown,
  adminUid: string,
): Promise<EnrolledExamCardSettings> {
  const settings = validateEnrolledExamCard(input);
  await fetchEnrolledExamCard();
  await exec(
    `INSERT INTO global_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [ENROLLED_EXAM_CARD_KEY, JSON.stringify(settings), adminUid],
  );
  return settings;
}

export async function resetEnrolledExamCard(): Promise<EnrolledExamCardSettings> {
  await fetchEnrolledExamCard();
  await exec("DELETE FROM global_settings WHERE setting_key = ?", [ENROLLED_EXAM_CARD_KEY]);
  return { ...DEFAULT_ENROLLED_EXAM_CARD };
}
