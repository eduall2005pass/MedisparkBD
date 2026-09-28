// Internal reference: MediSpark BD ওয়েবসাইট কীভাবে চলে।
// READ-ONLY। প্রতিটা পয়েন্ট কোডে যা আছে সেটাই বলে — নতুন কিছু না।

export type RuleDocItem = {
  id: string;
  title: string;
  text: string;
  source: string;
};

export type RuleDocSection = {
  id: string;
  category: string;
  title: string;
  intro: string;
  items: RuleDocItem[];
};

export const RULE_DOC_CATEGORIES = [
  "লগইন",
  "অ্যাডমিন ও রোল",
  "শিক্ষার্থী",
  "কোর্স",
  "ভর্তি ও পেমেন্ট",
  "পরীক্ষা",
  "প্রশ্নোত্তর",
  "কনটেন্ট ও মার্কেটিং",
  "মিডিয়া",
  "অ্যাডমিন প্যানেল",
  "API",
  "ডাটাবেজ",
  "ওয়েবসাইট সেটিংস",
  "নোটিফিকেশন",
  "সার্ভার",
  "সীমাবদ্ধতা",
] as const;

export const RULE_DOC_UPDATED = "27 Sep 2026";

export const RULE_DOC_SECTIONS: RuleDocSection[] = [
  {
    id: "authentication",
    category: "লগইন",
    title: "১. লগইন ও সেশন",
    intro: "লগইনের একটাই উপায়: Google দিয়ে সাইন-ইন। আর কোনো লগইন সিস্টেম নেই।",
    items: [
      {
        id: "AUTH-01",
        title: "শুধু Google দিয়ে লগইন হয়",
        text: "ইউজার Google বাটনে ক্লিক করে লগইন করে। একবার লগইন করলে ব্রাউজারে সেশন থেকে যায়, বারবার লগইন লাগে না।",
        source: "src/lib/auth-context.tsx, CODEBASE_SUMMARY.md",
      },
      {
        id: "AUTH-02",
        title: "প্রতিটা API কলে লগইন টোকেন যায়",
        text: "অ্যাপ প্রতিটা রিকোয়েস্টের সাথে Firebase টোকেন পাঠায়। সার্ভার টোকেন চেক করে। টোকেন না থাকলে বা ভুল হলে 401 এরর দেয় — মানে লগইন ছাড়া ঢোকা যাবে না।",
        source: "src/lib/auth-api.ts, src/lib/firebase-admin.ts, API_REFERENCE.md",
      },
      {
        id: "AUTH-03",
        title: "টোকেন নিজে নিজে রিফ্রেশ হয়",
        text: "Firebase টোকেন প্রায় প্রতি ঘণ্টায় বদলায়। অ্যাডমিন পেজ খোলা থাকলে টোকেন নিজে নিজে নতুন হয়। রিফ্রেশ ফেল করলেও পুরনো টোকেন মুছে না — যাতে ভুল করে লগআউট না হয়।",
        source: "src/components/admin/admin-ui.ts",
      },
      {
        id: "AUTH-04",
        title: "লগইনের সাথে সাথে প্রোফাইল লোড হয়",
        text: "লগইনের পর নিজে নিজে প্রোফাইল (/api/me) আর ভর্তি থাকা কোর্সগুলো লোড হয়। তারপর ড্যাশবোর্ড দেখা যায়, লগইন বাটন লুকিয়ে যায়।",
        source: "src/lib/auth-context.tsx, CODEBASE_SUMMARY.md",
      },
    ],
  },
  {
    id: "admin-roles",
    category: "অ্যাডমিন ও রোল",
    title: "২. অ্যাডমিন ও রোলের নিয়ম",
    intro: "কে অ্যাডমিন সেটা admins টেবিল দেখে ঠিক হয়। শুধু বাটন লুকিয়ে রাখলেই হবে না — সার্ভার প্রতিটা কাজে চেক করে।",
    items: [
      {
        id: "ADM-01",
        title: "UID বা ভেরিফাইড ইমেইল মিললেই অ্যাডমিন",
        text: "Firebase UID — অথবা ভেরিফাইড ইমেইল (Firebase প্রজেক্ট বদলালেও কাজ করে) — admins টেবিলে থাকতে হবে, আর is_active = 1 হতে হবে। বন্ধ (inactive) অ্যাডমিন ঢুকতে পারবে না।",
        source: "src/lib/admin.ts → isAdminUid, requireAdmin",
      },
      {
        id: "ADM-02",
        title: "৩টা রোল, ১০টা পারমিশন",
        text: "admin = সব ১০টা ক্ষমতা। moderator = ৯টা (শুধু manageAdmins নেই)। teacher = ৬টা (manageContent, manageExams, manageCourseContent, managePublicExam, manageQa, manageResults)। রোল না থাকলে বা পারমিশন না থাকলে ঢোকা যাবে না।",
        source: "src/lib/admin-access.ts, tests/admin-authorization.test.ts",
      },
      {
        id: "ADM-03",
        title: "manageAdmins কাউকে দেওয়া যায় না",
        text: "অ্যাডমিন চাইলেও moderator বা teacher-কে manageAdmins দিতে পারবে না — সার্ভার সেভের সময় কেটে দেয়। তাই Admin Center শুধু অ্যাডমিনেরই থাকে।",
        source: "src/lib/administration.ts → saveRolePermissions",
      },
      {
        id: "ADM-04",
        title: "অ্যাডমিনের প্রতিটা কাজ রেকর্ড থাকে",
        text: "কিছু বদলালেই admin_activity_logs-এ লেখা থাকে (কে, কী করল, কখন)। লগ লেখা ফেল করলেও আসল কাজ আটকায় না। লগইন প্রতি ৩০ মিনিটে একবার রেকর্ড হয়।",
        source: "src/lib/administration.ts → logAdminAction, recordAdminLogin",
      },
      {
        id: "ADM-05",
        title: "অ্যাডমিন চেক ৫ মিনিট মনে রাখা হয়",
        text: "পেজ বদলালে বারবার চেক না করে ৫ মিনিটের জন্য মনে রাখা হয়, তাই পেজ তাড়াতাড়ি খোলে। কিন্তু পেছনে সার্ভারে আবার চেক হয় — পারমিশন বদলালে সেটাই চলবে।",
        source: "src/components/admin/admin-ui.ts, src/app/api/admin/route.ts",
      },
    ],
  },
  {
    id: "students",
    category: "শিক্ষার্থী",
    title: "৩. শিক্ষার্থী ও রেজিস্ট্রেশন",
    intro: "প্রতিটা শিক্ষার্থীর Firebase UID থাকে, সাথে MS-XXXXXXXX মতো সুন্দর একটা আইডি।",
    items: [
      {
        id: "STU-01",
        title: "রেজিস্ট্রেশনের সময় প্রোফাইল তৈরি হয়",
        text: "students টেবিলে uid (Firebase UID) আসল চাবি, আর student_id হলো MS-XXXXXXXX হ্যান্ডেল। /api/me দিয়ে প্রোফাইল দেখা (GET), নতুন রেজিস্ট্রেশন (POST), আপডেট (PATCH) হয়।",
        source: "CODEBASE_SUMMARY.md, API_REFERENCE.md → /api/me",
      },
      {
        id: "STU-02",
        title: "ভর্তি থাকলেই কোর্স খুলবে",
        text: "enrollments টেবিলে লেখা থাকে কোন কোর্স, ফ্রি না পেইড, ফি কত, স্ট্যাটাস কী (pending/active/cancelled/completed)। শুধু active ভর্তি থাকলে কোর্স আর পরীক্ষা খুলবে।",
        source: "CODEBASE_SUMMARY.md → enrollments",
      },
    ],
  },
  {
    id: "courses",
    category: "কোর্স",
    title: "৪. কোর্স ও ক্যাটালগ",
    intro: "সবাই দেখে পাবলিক ক্যাটালগ, ভেতরে অ্যাডমিন কোর্স সাজায়।",
    items: [
      {
        id: "CRS-01",
        title: "শুধু published + available কোর্স সবাই দেখে",
        text: "catalog_courses-এ slug দিয়ে চেনা হয়। status (published/unpublished) আর availability (available/hidden) ঠিক করে কে দেখবে। ফ্রি/পেইড, ফি, ছাড়, ছবি, ব্যাচ, কুপন — সব অ্যাডমিন /api/admin/courses দিয়ে বদলায়।",
        source: "CODEBASE_SUMMARY.md, API_REFERENCE.md → /api/admin/courses",
      },
      {
        id: "CRS-02",
        title: "কোর্সের ভেতর ১–৫ নম্বর ফ্লো থাকে",
        text: "প্রতিটা কোর্সে একটা ফ্লো বাছা থাকে (Flow 1 = সরাসরি subject→chapter … Flow 5 = পরীক্ষা-ভিত্তিক)। chapter, subject আর course_content_flow দিয়ে সাজানো হয়।",
        source: "CODEBASE_SUMMARY.md → Flow-Based Course Content, src/lib/course-content.ts",
      },
      {
        id: "CRS-03",
        title: "ক্যাটাগরি, ব্যাচ, ফিচার্ড — সব অ্যাডমিন বসায়",
        text: "কোর্স ভাগ হয় ক্যাটাগরি (SSC/HSC/Medical/Varsity) আর ব্যাচ দিয়ে। হোমপেজে কোনটা দেখাবে সেটা featured_courses আর homepage সেটিংস দিয়ে অ্যাডমিন ঠিক করে।",
        source: "CODEBASE_SUMMARY.md → catalog_courses, featured_courses",
      },
    ],
  },
  {
    id: "enrollment-payments",
    category: "ভর্তি ও পেমেন্ট",
    title: "৫. ভর্তি ও পেমেন্ট",
    intro: "ফ্রি কোর্সে এক ক্লিকে ভর্তি। পেইড কোর্সে টাকা পাঠিয়ে প্রমাণ দিতে হয়, অ্যাডমিন দেখে approve করে।",
    items: [
      {
        id: "ENR-01",
        title: "ফ্রি কোর্সে সাথে সাথে ভর্তি",
        text: "একটা POST দিলেই active ভর্তি হয়ে যায়। তবু সার্ভার চেক করে: কোর্স আছে কি না, আগে ভর্তি আছে কি না।",
        source: "src/app/api/enrollments (via CODEBASE_SUMMARY.md flow)",
      },
      {
        id: "ENR-02",
        title: "পেইড কোর্সে পেমেন্ট প্রমাণ লাগে",
        text: "পেইড ভর্তিতে লাগে: transactionId (৪–৬৪ অক্ষর), senderMobile (+8801XXXXXXXXX ফরম্যাট), paymentMethod (bkash/nagad), চাইলে couponCode। সার্ভার চেক করে: রেজিস্টার্ড শিক্ষার্থী কি না, কোর্স আছে কি না, আগে active ভর্তি আছে কি না, transaction ID আগে ব্যবহার হয়নি কি না। সব ঠিক থাকলে pending ভর্তি + পেমেন্ট রেকর্ড হয়।",
        source: "CODEBASE_SUMMARY.md → Course Enrollment, API_REFERENCE.md → /api/enrollments",
      },
      {
        id: "ENR-03",
        title: "অ্যাডমিন approve করলে pending → active",
        text: "পেইড ভর্তি প্রথমে pending থাকে। অ্যাডমিন /api/admin/enrollments দিয়ে approve বা reject করে। শুধু active হলেই কোর্স, পরীক্ষা আর প্রশ্ন করার সুযোগ খুলবে।",
        source: "CODEBASE_SUMMARY.md, API_REFERENCE.md → /api/admin/enrollments",
      },
      {
        id: "ENR-04",
        title: "কুপন ছাড় সার্ভার নিজে হিসাব করে",
        text: "ইউজার কত ছাড় বলল সেটা বিশ্বাস করা হয় না। সার্ভার কুপন আবার চেক করে (আছে কি না, মেয়াদ আছে কি না, লিমিট শেষ কি না) নিজে দাম হিসাব করে।",
        source: "src/lib/coupons.ts, API_REFERENCE.md",
      },
      {
        id: "ENR-05",
        title: "এক transaction ID দুইবার চলবে না",
        text: "একটা transaction ID একবারই ব্যবহার করা যায় — যাতে এক প্রমাণে দুইজন ভর্তি হতে না পারে। একসাথে দুইজন চেষ্টা করলেও row lock দিয়ে আটকানো হয়।",
        source: "CODEBASE_SUMMARY.md → withTransaction, SELECT … FOR UPDATE",
      },
    ],
  },
  {
    id: "exams",
    category: "পরীক্ষা",
    title: "৬. পরীক্ষা — দেওয়া, নম্বর, সেশন",
    intro: "পাবলিক, প্র্যাকটিস, ভর্তি কোর্স — সবার জন্য একটাই পরীক্ষা ইঞ্জিন। শুধু কে দিতে পারবে সেটা আলাদা।",
    items: [
      {
        id: "EXM-01",
        title: "পরীক্ষার ধরন আর অবস্থাই আসল",
        text: "kind = public / practice / enrolled। status = draft / published / closed। draft কেউ দেখে না, published সময়ের ভেতরে দেওয়া যায়, closed হলে নতুন করে দেওয়া যায় না।",
        source: "CODEBASE_SUMMARY.md → Unified Exam Engine, exams table",
      },
      {
        id: "EXM-02",
        title: "পরীক্ষা চলার সময় সঠিক উত্তর ব্রাউজারে যায় না",
        text: "শুরুতে শুধু প্রশ্ন পাঠানো হয়, উত্তর না। খাতা জমার পর সার্ভার নিজে নম্বর দেয়। তাই ব্রাউজার থেকে উত্তর চুরি করা যায় না।",
        source: "src/lib/exam-taking.ts, src/app/api/exams/[id]",
      },
      {
        id: "EXM-03",
        title: "শুরুতে ৫টা জিনিস চেক হয়",
        text: "শুরু করার আগে দেখা হয়: লগইন আছে কি না, পরীক্ষা published আর চালু কি না, সময়ের ভেতরে কি না, চেষ্টার লিমিট শেষ কি না, আর কোর্স পরীক্ষা হলে active ভর্তি আছে কি না। তারপর in-progress খাতা + ডিভাইস সেশন তৈরি হয়।",
        source: "CODEBASE_SUMMARY.md → Exam Taking, src/lib/exam-lifecycle.ts",
      },
      {
        id: "EXM-04",
        title: "নম্বর = সঠিক×marks − ভুল×penalty",
        text: "প্রতিটা সঠিকে পুরো নম্বর, প্রতিটা ভুলে negative_per_wrong কাটা (যেমন 0.25) — যদি নেগেটিভ মার্কিং চালু থাকে। দ্বিতীয়বার (second-timer) দিলে আরও কিছু শতাংশ কাটতে পারে। প্রথমবারে কাটে না।",
        source: "src/lib/exam-taking.ts, exams table columns",
      },
      {
        id: "EXM-05",
        title: "এক ডিভাইসে লক হয়, সময় শেষে নিজে জমা হয়",
        text: "নতুন ডিভাইসে শুরু করলে পুরনো সেশন বন্ধ হয়ে তার উত্তর জমা হয়ে যায়। সময় শেষ হলেও নিজে জমা হয়। ফল exam_results-এ থাকে, মেধাতালিকা exam_rankings-এ আগে থেকে হিসাব করা থাকে।",
        source: "CODEBASE_SUMMARY.md → Exam Taking, exam_sessions table",
      },
      {
        id: "EXM-06",
        title: "প্রতিটা পরীক্ষার নিয়ম শুধু ওই পরীক্ষার",
        text: "exam_rules-এর প্রতিটা লাইন ঠিক একটা exam_id-এর। আপডেট, ডিলিট, সাজানো সবসময় (id AND exam_id) দিয়ে হয়। নতুন পরীক্ষায় আগে থেকে ৮টা বাংলা নিয়ম দেওয়া থাকে, পরে বদলানো যায়।",
        source: "src/lib/exam-rules.ts, src/app/api/admin/exam-rules/route.ts",
      },
    ],
  },
  {
    id: "qa",
    category: "প্রশ্নোত্তর",
    title: "৭. প্রশ্নোত্তর ফোরাম",
    intro: "শিক্ষার্থী প্রশ্ন করে, টিচার পরে উত্তর দেয়। শুধু পেইড ভর্তি থাকলে প্রশ্ন করা যায়।",
    items: [
      {
        id: "QA-01",
        title: "প্রশ্ন করতে active পেইড ভর্তি লাগে",
        text: "POST /api/qa-তে চেক হয়: লগইন আছে, ওই কোর্সে active ভর্তি আছে, কমপক্ষে একটা active পেইড ভর্তি আছে, category→course→subject ঠিক আছে, আর লেখা ৫–২০০০ অক্ষরের ভেতরে।",
        source: "CODEBASE_SUMMARY.md → Q&A flow, API_REFERENCE.md → POST /api/qa",
      },
      {
        id: "QA-02",
        title: "ছবি দেওয়া যায়, অডিও যায় না",
        text: "প্রশ্নের সাথে ছবির লিংক দেওয়া যায়। অডিও প্রশ্ন নেওয়া হয় না (কোডে পুরনো লেখা থাকতে পারে)। টিচার অ্যাডমিন প্যানেল থেকে উত্তর না দেওয়া পর্যন্ত প্রশ্ন unanswered থাকে।",
        source: "CODEBASE_SUMMARY.md → Q&A, src/lib/qa-store.ts",
      },
    ],
  },
  {
    id: "content-marketing",
    category: "কনটেন্ট ও মার্কেটিং",
    title: "৮. কনটেন্ট ও মার্কেটিং",
    intro: "পাবলিক লিস্টে শুধু publish করা জিনিস দেখায়। বাকিগুলো অ্যাডমিন দেখে approve করে।",
    items: [
      {
        id: "CNT-01",
        title: "রিভিউ, FAQ, ব্যানার, মেন্টর — publish flag মানে",
        text: "reviews API শুধু published রিভিউ দেয়। FAQ, ব্যানার স্লাইড, মেন্টরে is_active / status flag আছে। অ্যাডমিন প্যানেল থেকে publish, reject বা delete করে। ছবি বদলালে VM থেকে পুরনো ফাইল মুছে যায়।",
        source: "src/app/api/reviews, src/lib/reviews-store.ts, src/lib/faq-store.ts",
      },
      {
        id: "CNT-02",
        title: "কুপনে ধরন, মান, লিমিট, মেয়াদ থাকে",
        text: "কুপনে থাকে: code, discount_type (fixed/percent), discount_value, usage_limit/used_count, valid_from/until, is_active। /api/admin/coupons দিয়ে ম্যানেজ হয়, ব্যবহারের সময় সার্ভার চেক করে।",
        source: "CODEBASE_SUMMARY.md → coupons, API_REFERENCE.md",
      },
    ],
  },
  {
    id: "media",
    category: "মিডিয়া",
    title: "৯. মিডিয়া ও ফাইল আপলোড",
    intro: "ফাইল থাকে নিজেদের VM-এ। ডাটাবেজে শুধু লিংক থাকে।",
    items: [
      {
        id: "MED-01",
        title: "আপলোড-ডিলিটে গোপন টোকেন লাগে",
        text: "nginx /var/www/medispark-uploads/ ফোল্ডারটাকে medispark.duckdns.org/medifiles লিংকে দেখায়। আপলোড/ডিলিটে MEDIA_UPLOAD_TOKEN (X-Medifiles-Token হেডার) লাগে। ফাইলের ধরন extension দেখে ঠিক হয়।",
        source: "src/lib/storage.ts, server/medifiles-server.mjs, CODEBASE_SUMMARY.md",
      },
      {
        id: "MED-02",
        title: "অনেক পুরনো ফাইল এখনো DB-তে আছে",
        text: "খুব পুরনো কিছু আপলোড MySQL blob হিসেবে আছে, ওগুলো /api/files/<id> দিয়ে পড়া যায়। নতুন সব VM-এ লিংক হিসেবে থাকে।",
        source: "CODEBASE_SUMMARY.md → Media VM",
      },
    ],
  },
  {
    id: "admin-panel",
    category: "অ্যাডমিন প্যানেল",
    title: "১০. অ্যাডমিন প্যানেলের গঠন",
    intro: "বামে মেনু + হোমে কার্ড — দুই জায়গায় একই পারমিশন ম্যাপ দিয়ে লুকানো/দেখানো হয়।",
    items: [
      {
        id: "PNL-01",
        title: "বাম মেনুতে কন্ট্রোল সেকশন থাকে",
        text: "HOME-এর সাথে Website, Enrollment, Home Page, Course, Course Content, Material PDF, Public Exam, Q&A, Dashboard, Student, Result, Notification Control, Rules, Admin Center — যার যা পারমিশন আছে সে শুধু সেটাই দেখে।",
        source: "src/components/admin/AdminShell.tsx",
      },
      {
        id: "PNL-02",
        title: "পারমিশন না থাকলে সুন্দর করে না বলে, লুপে ফেলে না",
        text: "কারো পারমিশন নেই এমন পেজ খুললে access-denied কার্ড + হোমে ফেরার লিংক দেখায়। /admin হাব আর /admin/profile সব অ্যাডমিনের জন্য খোলা, কিন্তু ভেতরের ডাটা পারমিশন ছাড়া খুলবে না।",
        source: "src/components/admin/AdminShell.tsx, src/lib/admin-access.ts",
      },
      {
        id: "PNL-03",
        title: "সার্চে শুধু অনুমতি থাকা সেকশন আসে",
        text: "উপরের সার্চ (আর মোবাইল সার্চ) একই পারমিশন ম্যাপ দিয়ে ফিল্টার করে। চেক শেষ না হওয়া পর্যন্ত কিছু দেখায় না।",
        source: "src/components/admin/AdminSearch.tsx",
      },
    ],
  },
  {
    id: "apis",
    category: "API",
    title: "১১. API-এর নিয়ম",
    intro: "/api-এর নিচে REST, অ্যাডমিন কাজ /api/admin-এ, এরর একই ফরম্যাটে।",
    items: [
      {
        id: "API-01",
        title: "পাবলিক vs শিক্ষার্থী vs অ্যাডমিন রুট",
        text: "পাবলিক পড়া (courses, public-exams, qa দেখা, reviews, faqs, settings) — টোকেন লাগে না। শিক্ষার্থীর লেখা — টোকেন লাগে। /api/admin-এর সব — টোকেন + অ্যাডমিন + (বদলানোর কাজে) ঠিক পারমিশন লাগে।",
        source: "API_REFERENCE.md, src/app/api/admin/*",
      },
      {
        id: "API-02",
        title: "এরর একই JSON-এ আসে",
        text: "ভুল হলে { error: \"সহজ বার্তা\" } আসে। কোড: 400 ভুল ইনপুট, 401 টোকেন নেই/ভুল, 403 নিষেধ, 404 পাওয়া যায়নি, 409 ডুপ্লিকেট (যেমন একই rule/transaction দুইবার), 500 সার্ভার সমস্যা।",
        source: "API_REFERENCE.md → Error Responses",
      },
      {
        id: "API-03",
        title: "লিস্টে পেজিং আছে, rate limit নেই",
        text: "লিস্ট API-তে page/limit দিলে total/hasMore আসে। rate limiting এখনো নেই — ডক্সে DDoS রিস্ক হিসেবে লেখা আছে।",
        source: "API_REFERENCE.md → Pagination, CODEBASE_SUMMARY.md → Limitations",
      },
    ],
  },
  {
    id: "database",
    category: "ডাটাবেজ",
    title: "১২. ডাটাবেজের নিয়ম",
    intro: "VM MariaDB, pool দিয়ে কানেকশন, ছোট ক্যাশ, যোগ করে মাইগ্রেশন।",
    items: [
      {
        id: "DB-01",
        title: "৮ কানেকশনের pool, নিরাপদ query",
        text: "mysql2 pool (৮ কানেকশন, ফাঁকা থাকলে তাড়াতাড়ি ছাড়ে)। সব query placeholder দিয়ে হয়, তাই SQL injection হয় না।",
        source: "src/lib/mysql.ts",
      },
      {
        id: "DB-02",
        title: "SELECT ৫ সেকেন্ড ক্যাশ থাকে, লিখলেই মুছে",
        text: "সাধারণ SELECT ৫ সেকেন্ড মনে রাখা হয় (৫০০টা পর্যন্ত)। locking read বা schema চেকে ক্যাশ নেই। INSERT/UPDATE/DELETE হলেই ওই টেবিলের ক্যাশ মুছে যায়।",
        source: "src/lib/mysql.ts → query cache",
      },
      {
        id: "DB-03",
        title: "টাকার কাজ transaction-এ হয়",
        text: "ভর্তি + পেমেন্ট প্রমাণ একসাথে withTransaction-এ হয়, row lock (SELECT … FOR UPDATE) দিয়ে — যাতে দুইজন একসাথে করলেও ডাবল না হয়।",
        source: "src/lib/mysql.ts → withTransaction, CODEBASE_SUMMARY.md",
      },
      {
        id: "DB-04",
        title: "স্কিমা শুধু যোগ হয়, নিজে নিজে ঠিক হয়",
        text: "মাইগ্রেশন src/sql/*.sql-এ থাকে, টেবিল ডিলিট করা যাবে না। কোড CREATE TABLE IF NOT EXISTS + ensureColumn (information_schema দেখে) ব্যবহার করে।",
        source: "src/lib/mysql.ts → ensureColumn, CODEBASE_SUMMARY.md",
      },
    ],
  },
  {
    id: "website-settings",
    category: "ওয়েবসাইট সেটিংস",
    title: "১৩. ওয়েবসাইট সাজানো",
    intro: "লোগো, হোমপেজ, মেনু — সব ডাটাবেজ থেকে আসে, অ্যাডমিন বদলায়।",
    items: [
      {
        id: "WEB-01",
        title: "ব্র্যান্ডিং, হিরো, থিম, মেনু, SEO — সব টেবিলে",
        text: "website_settings, hero_settings, theme_settings (light/dark + রং), navbar_settings, seo-settings, logos, banners, homepage sections, mentors, footer/contact — সব অ্যাডমিন বদলাতে পারে। লিখতে অ্যাডমিন লগইন লাগে।",
        source: "CODEBASE_SUMMARY.md → Website Configuration Tables, src/lib/website-settings.ts",
      },
    ],
  },
  {
    id: "notifications",
    category: "নোটিফিকেশন",
    title: "১৪. নোটিফিকেশন ও পুশ",
    intro: "ডিভাইস টোকেন দিয়ে গ্রুপে পুশ যায়। না গেলে আবার চেষ্টা হয় না।",
    items: [
      {
        id: "NTF-01",
        title: "প্রতি ডিভাইসে টোকেন, পাঠানো bulk-এ",
        text: "পুশ টোকেন push_tokens-এ থাকে। অ্যাডমিন গ্রুপে (সবাই / পেইড / ফ্রি) একসাথে পাঠায়। না গেলে retry হয় না।",
        source: "CODEBASE_SUMMARY.md → Push Notification Model, API_REFERENCE.md",
      },
    ],
  },
  {
    id: "deployment",
    category: "সার্ভার",
    title: "১৫. সার্ভার ও ডিপ্লয়",
    intro: "ওয়েব অ্যাপ Vercel-এ + ডাটাবেজ VM-এ + মিডিয়া VM-এ + লগইন Firebase-এ।",
    items: [
      {
        id: "DEP-01",
        title: "main-এ পুশ দিলেই Vercel ডিপ্লয় হয়",
        text: "main ব্রাঞ্চে পুশ দিলে নিজে ডিপ্লয় হয়। সেটিংস আসে environment থেকে (Vercel dashboard বা .env): MYSQL_*, NEXT_PUBLIC_FIREBASE_*, FIREBASE_* , MEDIA_*। গোপন জিনিস কোডে থাকে না।",
        source: "CODEBASE_SUMMARY.md, next.config.ts",
      },
    ],
  },
  {
    id: "limitations",
    category: "সীমাবদ্ধতা",
    title: "১৬. যা এখনো ঠিক হয়নি",
    intro: "ডক্সে যা লেখা আছে সেটাই — এগুলো কাজ করে ভেবে ভুল হবে না।",
    items: [
      {
        id: "LIM-01",
        title: "মাইগ্রেশন হাতে, ব্যাকআপ হাতে, rate limit নেই",
        text: "মাইগ্রেশন VM-এ হাতে দিতে হয়। MySQL ব্যাকআপ হাতে। API rate limiting নেই। অডিও প্রশ্ন বাদ (পুরনো লেখা থাকতে পারে)। PDF ম্যাটেরিয়াল আংশিক। Flow 5 UI-তে “Course Flow 4” দেখায়। student MS-ID শুধু লোকালি unique। second-timer কেস জটিল।",
        source: "CODEBASE_SUMMARY.md → Known Limitations & Tech Debt",
      },
    ],
  },
];
