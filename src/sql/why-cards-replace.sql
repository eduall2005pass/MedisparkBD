-- Replace the existing 6 "Why MediSpark" cards with 8 new ones
-- Run: ssh azureuser@VM 'sudo mysql <DB_NAME>' < src/sql/why-cards-replace.sql

DELETE FROM home_cards WHERE section = 'why';

INSERT INTO home_cards (card_key, section, title, description, value, icon, sort_order, is_active) VALUES
('expert-teacher-panel', 'why', 'Expert Teacher Panel', 'অভিজ্ঞ শিক্ষকদের guidance-এর মাধ্যমে তোমার পড়াশোনার সঠিক direction ও expert support পেতে পারবে।', NULL, 'teacher', 1, 1),
('structured-courses', 'why', 'Structured Courses', 'পরিকল্পিতভাবে সাজানো কোর্সের মাধ্যমে প্রতিটি বিষয় ধাপে ধাপে শিখতে পারবে।', NULL, 'book', 2, 1),
('live-recorded-classes', 'why', 'Live & Recorded Classes', 'Live class-এ অংশ নেওয়ার পাশাপাশি recorded class দেখে যেকোনো সময় আবার revise করতে পারবে।', NULL, 'video', 3, 1),
('live-practice-exams', 'why', 'Live & Practice Exams', 'Live ও Practice Exam-এর মাধ্যমে নিয়মিত পরীক্ষা দিয়ে তোমার প্রস্তুতি আরও শক্তিশালী করতে পারবে।', NULL, 'exam', 4, 1),
('expert-qa-support', 'why', 'Expert Q&A Support', 'যেকোনো প্রশ্ন করে expert guidance-এর মাধ্যমে তোমার confusion দূর করতে পারবে।', NULL, 'chat', 5, 1),
('study-materials', 'why', 'Study Materials', 'প্রয়োজনীয় notes, study materials ও resources এক জায়গা থেকে পেতে পারবে।', NULL, 'document', 6, 1),
('track-your-progress', 'why', 'Track Your Progress', 'তোমার learning progress ও exam performance সহজেই দেখতে পারবে।', NULL, 'chart', 7, 1),
('win-a-gift', 'why', 'Win a Gift', 'ভালো ফলাফল করে MediSpark-এর পক্ষ থেকে সহজেই আকর্ষণীয় পুরস্কার বা gift জিতে নিতে পারবে।', NULL, 'gift', 8, 1);
