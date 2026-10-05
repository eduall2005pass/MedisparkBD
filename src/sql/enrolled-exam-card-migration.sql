-- Global, keyed UI settings. Safe to apply repeatedly; never overwrites admin edits.
CREATE TABLE IF NOT EXISTS global_settings (
  setting_key VARCHAR(191) NOT NULL PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by VARCHAR(191) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO global_settings (setting_key, setting_value)
VALUES ('my_enrolled_exams', JSON_OBJECT(
  'is_active', JSON_EXTRACT('true', '$'),
  'title', 'My Enrolled Exams',
  'subtitle', 'Go directly to exams in your enrolled courses.',
  'icon', 'clipboard-list'
));
