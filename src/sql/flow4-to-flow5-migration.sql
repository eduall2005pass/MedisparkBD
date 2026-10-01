-- Migrate legacy flow-4 (unused Subject→Content) to flow-5 (Course Flow 4 / Exam Flow)
-- Run: ssh azureuser@VM 'sudo mysql <DB_NAME>' < src/sql/flow4-to-flow5-migration.sql

UPDATE catalog_courses SET content_layout = 'flow-5' WHERE content_layout = 'flow-4';
