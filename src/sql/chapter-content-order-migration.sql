-- Unified chapter content ordering (Classes · Exams · Materials)
-- Manual cross-type order inside one chapter shares a single sort_order
-- sequence across the three content tables:
--   course_classes.sort_order, course_materials.sort_order, exams.sort_order
-- The admin saves positions 1..N across all types (e.g. 1 Class, 2 Material,
-- 3 Exam); student + admin learning queries already ORDER BY sort_order, so
-- the saved sequence is reflected everywhere automatically.
--
-- Reordering updates ONLY sort_order — never titles, files, questions or
-- any other content column. Serials shown in the UI are derived
-- (position in the sorted list), so deletes can never break them.
-- New content is appended at MAX(sort_order)+1 of its chapter.
--
-- Apply: ssh azureuser@VM 'sudo mysql <DB_NAME>' < src/sql/chapter-content-order-migration.sql
-- Safe to re-run (all statements are idempotent). The application also
-- self-heals missing columns at runtime via ensureOrderSchema().

-- 1) Ordering columns (IF NOT EXISTS — MariaDB 10.2+ / MySQL 8).
ALTER TABLE course_classes ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE course_materials ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0 AFTER chapter_id;

-- 2) Per-chapter ordering indexes (CREATE INDEX IF NOT EXISTS — MariaDB).
CREATE INDEX IF NOT EXISTS idx_classes_chapter_sort ON course_classes (chapter_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_materials_chapter_sort ON course_materials (chapter_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_exams_chapter_sort ON exams (chapter_id, sort_order);
