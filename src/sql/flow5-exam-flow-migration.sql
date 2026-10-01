-- ═══════════════════════════════════════════════════════════════════════════
-- Flow 5 — Exam Flow: Course → 4 Exam Cards → (Topic-wise → 8 Subjects | direct lists)
-- ADDITIVE migration. Existing Flows 1-4 and all existing exam behaviour stay
-- unchanged. Legacy exams keep exam_format NULL and never appear in Flow 5.
--
-- Navigation:
--   Course → Topic-wise Exam → 8 Subject Cards → Topic-wise Exams
--   Course → Paper Final Exam → Direct Exam List (no subject page)
--   Course → Subject Final Exam → Direct Exam List (no subject page)
--   Course → Final Model Test → Direct Exam List (no subject page)
--
-- Apply: ssh azureuser@VM 'sudo mysql <DB_NAME>' < src/sql/flow5-exam-flow-migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Exam category/type column: separates the 4 Flow-5 exam categories.
--    NULL = legacy exam (old Exam flow) — never mixed into Flow 5 lists.
-- NOTE: Azure MySQL here does NOT support `ADD COLUMN IF NOT EXISTS` —
-- re-running section 1-2 errors on existing columns (safe to ignore).
ALTER TABLE exams
  ADD COLUMN exam_format ENUM('topic-wise','paper-final','subject-final','final-model') NULL DEFAULT NULL AFTER course_type;

-- 2) Topic-wise subject association: one of the 8 fixed Flow-5 subjects.
--    Only meaningful when exam_format = 'topic-wise'.
ALTER TABLE exams
  ADD COLUMN topic_subject VARCHAR(64) NULL DEFAULT NULL AFTER exam_format;

-- 3) Index for Flow-5 listing queries (course link + format + subject).
CREATE INDEX idx_exams_flow5_format ON exams(exam_format, topic_subject, status);

-- 4) Widen catalog_courses.content_layout ENUM to include flow-5.
--    Step 1: widen (accept old + all flow values), Step 2: keep every
--    existing row on its current layout, Step 3: narrow to the 5 flows.
ALTER TABLE catalog_courses
  MODIFY COLUMN content_layout ENUM('auto','direct','paper','subject','flow-1','flow-2','flow-3','flow-4','flow-5') NOT NULL DEFAULT 'flow-1';

UPDATE catalog_courses SET content_layout = 'flow-1' WHERE content_layout IN ('auto', 'direct');
UPDATE catalog_courses SET content_layout = 'flow-2' WHERE content_layout = 'paper';
UPDATE catalog_courses SET content_layout = 'flow-3' WHERE content_layout = 'subject';

ALTER TABLE catalog_courses
  MODIFY COLUMN content_layout ENUM('flow-1','flow-2','flow-3','flow-4','flow-5') NOT NULL DEFAULT 'flow-1';
