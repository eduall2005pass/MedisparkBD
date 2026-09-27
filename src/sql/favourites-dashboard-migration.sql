-- Favourite Dashboard: extend student_favourites to 4 categories (class, exam, material, qa)
-- Run after student-learning-migration.sql

-- Ensure table exists with broader type (VARCHAR) so future types never need ENUM alters.
-- If table already exists with ENUM('class','material'), convert to VARCHAR.
ALTER TABLE student_favourites MODIFY COLUMN item_type VARCHAR(20) NOT NULL;
ALTER TABLE student_favourites MODIFY COLUMN item_id VARCHAR(191) NOT NULL;

-- In case table was not yet created (fresh DB), ensure full definition.
CREATE TABLE IF NOT EXISTS student_favourites (
  student_uid VARCHAR(128) NOT NULL,
  item_type VARCHAR(20) NOT NULL,
  item_id VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY student_favourites_unique (student_uid, item_type, item_id),
  KEY idx_fav_user_type (student_uid, item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for JOIN performance in favourites details queries
-- Course classes
ALTER TABLE course_classes ADD INDEX IF NOT EXISTS idx_cc_chapter (chapter_id);
ALTER TABLE course_classes ADD INDEX IF NOT EXISTS idx_cc_active (is_active);
-- Course chapters
ALTER TABLE course_chapters ADD INDEX IF NOT EXISTS idx_ch_subject (subject_id);
ALTER TABLE course_chapters ADD INDEX IF NOT EXISTS idx_ch_active (is_active);
-- Course subject assignments
ALTER TABLE course_subject_assignments ADD INDEX IF NOT EXISTS idx_csa_subject (subject_id);
ALTER TABLE course_subject_assignments ADD INDEX IF NOT EXISTS idx_csa_course (course_slug);
-- Course materials
ALTER TABLE course_materials ADD INDEX IF NOT EXISTS idx_cm_chapter (chapter_id);
ALTER TABLE course_materials ADD INDEX IF NOT EXISTS idx_cm_active (is_active);
-- Exams
ALTER TABLE exams ADD INDEX IF NOT EXISTS idx_ex_chapter (chapter_id);
ALTER TABLE exams ADD INDEX IF NOT EXISTS idx_ex_status (status);
-- Enrollments
ALTER TABLE enrollments ADD INDEX IF NOT EXISTS idx_en_student (student_uid);
ALTER TABLE enrollments ADD INDEX IF NOT EXISTS idx_en_course_status (course_id, enrollment_status);
-- Catalog courses
ALTER TABLE catalog_courses ADD INDEX IF NOT EXISTS idx_cc_slug (slug);
