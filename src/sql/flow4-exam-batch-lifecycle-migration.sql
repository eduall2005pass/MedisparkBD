-- Flow 4 Exam Batch — Live → Practice lifecycle
-- Apply: ssh azureuser@VM 'sudo mysql <DB_NAME>' < src/sql/flow4-exam-batch-lifecycle-migration.sql
--
-- This lifecycle is ONLY for Course Content Flow 4 Exam Batch (enrolled exams
-- linked to a catalog_courses.content_layout='flow-4' course).
-- Public Exam Keep Existing Behavior — no changes to public flow.
--
-- Behavior:
--   UPCOMING (before start) → LIVE (start ≤ now ≤ end) → PRACTICE (now > end)
--   LIVE submissions participate in Live Leaderboard (ranked by merit_position).
--   After end, exam stays visible for Practice; practice submissions do NOT
--   affect Live Leaderboard (frozen).
--
-- Schema: add attempt_type to exam_results to separate live vs practice.
-- Existing rows = live attempts. Practice attempts inserted after endsAt
-- must be marked 'practice' and excluded from merit_position recalculation.

-- 1) Add attempt_type to exam_results
ALTER TABLE exam_results
  ADD COLUMN IF NOT EXISTS attempt_type ENUM('live','practice') NOT NULL DEFAULT 'live' AFTER is_second_timer;

-- Ensure index for leaderboard queries that filter by live attempts
CREATE INDEX IF NOT EXISTS idx_exam_results_attempt_type ON exam_results (exam_id, attempt_type, score DESC);

-- 2) Optional: add practice-specific display helpers — no deletion, no schema removal
-- End of migration
