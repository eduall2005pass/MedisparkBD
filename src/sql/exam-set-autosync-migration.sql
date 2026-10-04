-- Exam Set Auto-Sync system: Bangla master + English translation cache.
-- Additive only. Safe to run multiple times.
-- Bangla rows live in exam_questions (MASTER). English lives ONLY in
-- question_translations (linked via question_id). Never duplicate masters.

CREATE TABLE IF NOT EXISTS exam_sets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  exam_id VARCHAR(64) NOT NULL,
  set_name ENUM('A','B') NOT NULL,
  status ENUM('draft','published','blocked') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_sets_exam_set (exam_id, set_name),
  KEY idx_exam_sets_exam (exam_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_translations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  question_id BIGINT UNSIGNED NOT NULL,
  question_uid VARCHAR(32) NULL,
  language ENUM('en') NOT NULL DEFAULT 'en',
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  explanation TEXT NULL,
  translation_status ENUM('pending','translating','completed','needs_update','failed','manually_edited') NOT NULL DEFAULT 'pending',
  translated_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_qt_qid_lang (question_id, language),
  KEY idx_qt_uid (question_uid),
  KEY idx_qt_status (translation_status),
  CONSTRAINT fk_qt_question FOREIGN KEY (question_id)
    REFERENCES exam_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
