# MediSparkBD - Complete Codebase Documentation

**Platform**: HSC Academic & Medical Admission Preparation  
**Tech Stack**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS  
**Database**: Azure Database for MySQL (TLS enforced)  
**Auth**: Firebase (Google sign-in)  
**Media**: Self-hosted VM (<MEDIA_HOST>)  

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              Vercel (Web App)                           │
│         Next.js 16 + React 19 + TypeScript              │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│         VM MariaDB                                    │
│  (<DB_HOST>:3306)                                │
│  - All application data stored here                      │
│  - Non-TLS, persistent service + nightly backups        │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│         Firebase (Authentication)                       │
│  - Google Sign-In (project: <FIREBASE_PROJECT>)                │
│  - Token verification on API routes                     │
│  - Web push notifications (VAPID key)                   │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│    Media server (self-hosted)                     │
│  - nginx serves the uploads directory             │
│  - Token-authenticated upload service (localhost) │
│  - Token-authenticated file operations                  │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 Directory Structure

```
MediSparkBD/
├── src/
│   ├── app/                           # Next.js App Router pages & API routes
│   │   ├── layout.tsx                 # Root layout (global providers)
│   │   ├── page.tsx                   # Homepage with dynamic sections
│   │   ├── admin/                     # Admin panel (protected routes)
│   │   │   ├── dashboard/             # Admin dashboard
│   │   │   ├── courses/               # Course management
│   │   │   ├── exams/                 # Exam management
│   │   │   ├── students/              # Student management
│   │   │   ├── enrollment-control/    # Enrollment settings
│   │   │   ├── public-exam/           # Public exam management
│   │   │   ├── qa-control/            # Q&A moderation
│   │   │   ├── administration/        # Admin accounts & roles
│   │   │   └── ...
│   │   ├── api/                       # REST API endpoints
│   │   │   ├── admin/                 # Admin-only APIs
│   │   │   ├── courses/               # Course APIs
│   │   │   ├── enrollments/           # Enrollment APIs
│   │   │   ├── exams/                 # Exam APIs
│   │   │   ├── qa/                    # Q&A APIs
│   │   │   ├── me/                    # Student profile APIs
│   │   │   ├── public-exams/          # Public exam APIs
│   │   │   └── ...
│   │   ├── courses/                   # Course catalog pages
│   │   ├── exam/                      # Exam taking pages
│   │   ├── dashboard/                 # Student dashboard
│   │   ├── login/                     # Auth pages
│   │   ├── qa/                        # Q&A pages
│   │   └── register/                  # Registration pages
│   ├── lib/                           # Shared business logic & utilities
│   │   ├── mysql.ts                   # MySQL connection pool & query helpers
│   │   ├── firebase.ts                # Firebase client config
│   │   ├── firebase-admin.ts          # Firebase Admin SDK
│   │   ├── auth-api.ts                # Token verification
│   │   ├── auth-context.tsx           # React auth context (Google sign-in)
│   │   ├── admin.ts                   # Admin authorization gates
│   │   ├── administration.ts          # Admin accounts & roles
│   │   ├── storage.ts                 # Media upload/delete operations
│   │   ├── courses.ts                 # Course types & helpers
│   │   ├── course-*.ts                # Course-related business logic
│   │   ├── enrollments.ts             # Enrollment types & operations
│   │   ├── exams-admin.ts             # Exam management
│   │   ├── exam-taking.ts             # Student exam experience
│   │   ├── exam-lifecycle.ts          # Exam state management
│   │   ├── qa.ts                      # Q&A types & guidelines
│   │   ├── qa-store.ts                # Q&A data access
│   │   ├── reviews.ts                 # Student reviews
│   │   ├── hero-settings.ts           # Homepage hero section
│   │   ├── homepage-sections.ts       # Dynamic homepage sections
│   │   ├── theme-settings.ts          # Theme customization
│   │   ├── website-settings.ts        # Website branding
│   │   ├── navbar.ts                  # Navbar configuration
│   │   └── ... (80+ more utility files)
│   ├── components/                    # Reusable React components
│   │   ├── Navbar.tsx                 # Navigation bar
│   │   ├── Footer.tsx                 # Footer
│   │   ├── Logo.tsx                   # Logo & branding
│   │   ├── ThemeProvider.tsx          # Dark/light theme
│   │   ├── ThemeToggle.tsx            # Theme switcher
│   │   ├── BottomNav.tsx              # Mobile bottom navigation
│   │   ├── home/                      # Homepage sections
│   │   │   ├── Hero.tsx               # Hero banner
│   │   │   ├── FeaturedCourses.tsx    # Featured courses display
│   │   │   ├── Mentors.tsx            # Mentor gallery
│   │   │   ├── StudentReviews.tsx     # Reviews section
│   │   │   ├── FaqSection.tsx         # FAQ section
│   │   │   ├── GlanceSection.tsx      # Stats glance
│   │   │   ├── JerseyGallery.tsx      # Media gallery
│   │   │   └── ...
│   │   ├── exam/                      # Exam-related components
│   │   │   ├── ExamLockContext.tsx    # Exam lock state management
│   │   │   ├── ExamResultClient.tsx   # Result display
│   │   │   └── ...
│   │   ├── admin/                     # Admin panel components
│   │   │   ├── AdminShell.tsx         # Admin layout wrapper
│   │   │   ├── CourseManager.tsx      # Course CRUD
│   │   │   ├── ExamManager.tsx        # Exam CRUD
│   │   │   ├── ExamQuestions.tsx      # Question editor
│   │   │   ├── FaqManager.tsx         # FAQ management
│   │   │   ├── MediaUploadField.tsx   # File upload UI
│   │   │   ├── LogoManager.tsx        # Logo management
│   │   │   └── ...
│   │   ├── auth/                      # Auth components
│   │   ├── dashboard/                 # Dashboard components
│   │   └── navigation/                # Navigation components
│   └── sql/                           # Database migrations (90+ files)
│       ├── exam-system-architecture-migration.sql
│       ├── students-enrollments-migration.sql
│       ├── course-content-structure-migration.sql
│       ├── qa-migration.sql
│       └── ... (comprehensive schema definitions)
├── package.json                       # Dependencies & scripts
├── tsconfig.json                      # TypeScript configuration
├── next.config.ts                     # Next.js configuration
├── tailwind.config.ts                 # Tailwind CSS config
└── README.md                          # Project documentation
```

---

## 🔌 Key Dependencies

### Runtime
- **next** 16.3.1 - React framework
- **react** 19.2.8, **react-dom** 19.2.8 - UI library
- **firebase** 12.17.1 - Client auth & config
- **firebase-admin** 13.10.0 - Server-side auth/token verification
- **mysql2** 3.23.3 - Database connection pool
- **sharp** 0.35.4 - Image optimization
- **jspdf** 4.2.1, **html2canvas** 1.4.1 - PDF generation
- **tailwindcss** 4 - Utility CSS framework

### Development
- **typescript** 5 - Type safety
- **eslint** 9 - Code linting

---

## 🗄️ Database Schema Overview

### Core Tables (Student Lifecycle)

#### `students` - Student registration
```sql
- uid (PK) - Firebase UID
- student_id - Unique MS-XXXXXXXX format
- full_name, gender, institution, hsc_batch
- contact_number, email, facebook_url
- profile_picture_url (VM-hosted)
- provider, created_at, updated_at
```

#### `enrollments` - Student course enrollments
```sql
- id (PK), student_uid (FK), course_id
- course_name, course_type (Academic/Admission)
- course_kind (free/paid), fee
- enrollment_status (pending/active/cancelled/completed)
- payment_* columns (transaction_id, amount, sender, method)
- enrollment_date, updated_at
```

#### `courses` - Course registry
```sql
- course_id (PK)
- kind (free/paid)
```

#### `student_ids` - ID uniqueness guarantee
```sql
- student_id (PK), uid, created_at
```

---

### Exam System Tables

#### `exams` - Master exam definitions
```sql
- id (PK)
- title, description, banner_url
- kind (public/practice/enrolled)
- type (public/course) - access scope
- exam_mode (live/practice)
- batch_id, subject, course_type
- duration_minutes, total_marks, negative_marks
- negative_enabled, negative_per_wrong
- second_timer_enabled, second_timer_deduction
- status (draft/published/closed)
- answer_key (JSON) - correct answers
- attempt_limit, active
- various flow-related columns
```

#### `exam_categories` - Public exam categories
```sql
- id (PK) - e.g., "ssc-academic"
- name, slug, description, icon
- sort_order, is_active
```

#### `exam_questions` - Exam question bank
```sql
- id (PK)
- exam_id (nullable - NULL = bank only)
- question_type, image_url
- options (JSON array)
- answer_key (for published answer keys)
- marks, subject, etc.
```

#### `exam_question_options` - Normalized options
```sql
- id (PK), question_id (FK)
- option_index, option_text
- is_correct, sort_order
```

#### `exam_results` - Exam attempt results
```sql
- id (PK)
- exam_id, student_uid
- correct_count, wrong_count, skipped_count
- score, time_taken_seconds
- submitted_at
- snapshot_* columns (marks, negative_per_wrong, duration, etc.)
```

#### `exam_rankings` - Pre-computed leaderboards
```sql
- id (PK)
- exam_id, student_uid, student_name, student_id
- score, total_marks, time_taken_seconds
- merit_position, submitted_at
```

#### `exam_attempts` - Active/historical attempts
```sql
- id (PK)
- exam_id, student_uid
- status (in_progress/submitted/abandoned)
- questions_seen, started_at, submitted_at
```

#### `exam_sessions` - Device & session tracking
```sql
- id (PK)
- exam_id, student_uid, session_token
- status (active/terminated/expired)
- ip_address, user_agent
- started_at, last_heartbeat, ended_at
```

---

### Course Structure Tables

#### `catalog_courses` - Public course catalog
```sql
- slug (PK), name, batch_id
- kind (free/paid), fee, discount_fee
- image_url (VM-hosted)
- short_description, description
- status (published/unpublished)
- availability (available/hidden)
- coupon_enabled
- Various metadata (total_classes, teachers, etc.)
```

#### `course_categories` - Course grouping
```sql
- id (PK), name, slug, icon
- description, sort_order, is_active
```

#### `chapters`, `subjects` - Course content hierarchy
- chapter_id (PK), name, course_id
- subject_id (PK), name, chapter_id

#### `course_content_flow` - Content organization by layout
```sql
- id (PK)
- course_id, layout_type (flow-1 to flow-5)
- content structure configuration
```

---

### Admin & Management Tables

#### `admins` - Admin accounts
```sql
- uid (PK) - Firebase UID
- email (verified), display_name
- photo_url, phone_number
- is_active, created_at, updated_at
```

#### `admin_roles` - Role-based access control
```sql
- id (PK), email, role
- permissions (JSON array)
- created_at, updated_at
```

#### `admin_activity_logs` - Audit trail
```sql
- id (PK), admin_uid, admin_email
- action, detail, ip_address
- created_at
```

---

### Q&A System Tables

#### `qa_subjects` - Question categories
```sql
- id (PK), name, order
```

#### `qa_questions` - Student questions
```sql
- id (PK)
- subject_id, category_id, course_id
- student_uid, student_name
- text, image_url, has_picture
- status (answered/unanswered)
- created_at
```

#### `qa_answers` - Teacher responses
```sql
- id (PK), question_id
- teacher_name, content
- answered_at, created_at
```

---

### Marketing & Content Tables

#### `banners` / `banner_slides` - Homepage banners
```sql
- id (PK), image_url, title, description
- order, is_active, created_at
```

#### `featured_courses` - Promotion list
```sql
- id (PK), course_id, order, is_active
```

#### `faqs` - FAQ content
```sql
- id (PK), question, answer
- category, order, is_active
- answer_type (text/video), video_url
```

#### `reviews` - Student testimonials
```sql
- id (PK)
- student_name, avatar_url, rating
- course_name, batch_label
- text, status (published/draft/rejected)
```

#### `mentors` - Mentor profiles
```sql
- id (PK), name, designation
- bio, photo_url, social_links, etc.
- is_active, order
```

#### `coupons` - Discount codes
```sql
- id (PK), code, discount_type (fixed/percent)
- discount_value, usage_limit, used_count
- valid_from, valid_until, is_active
```

---

### Website Configuration Tables

#### `website_settings` - Global branding
```sql
- site_title, meta_description, favicon_url
- contact_email, phone, address
- seo_keywords, etc.
```

#### `hero_settings` - Hero section config
```sql
- title, subtitle, cta_text
- background_image_url, is_active
```

#### `theme_settings` - Visual customization
```sql
- theme_mode (light/dark)
- primary_color, accent_color
- button_style, border_radius
```

#### `navbar_settings` - Navigation config
```sql
- menu_items (JSON), logo_position
- show_search, social_links, etc.
```

---

## 🔐 Authentication & Authorization

### Client-Side Auth (`src/lib/auth-context.tsx`)
- **Firebase Google Sign-In**: Popup + Redirect fallback
- **Persistent Login**: Uses browserLocalPersistence
- **Error Handling**: Redirect errors captured via sessionStorage
- **Profile Fetching**: Auto-loads student profile via `/api/me`
- **Enrollment Loading**: Fetches active enrollments

### Server-Side Auth (`src/lib/auth-api.ts`)
- **Token Verification**: `getFirebaseUser()` from Bearer token
- **Admin Gates**: `requireAdmin()` - checks `admins` table by UID or verified email
- **Permission Checks**: `requirePermission()` - role-based access

### Admin Authorization (`src/lib/admin.ts`)
1. Token verified via Firebase Admin SDK
2. UID/email lookup in `admins` table
3. Role + permissions fetched from `admin_roles`
4. Activity logged to `admin_activity_logs`

---

## 🛣️ API Routes Overview

### Public/Student APIs

#### `/api/me` - Student Profile
- **GET**: Fetch current student profile
- **POST**: Create profile (registration)
- **PATCH**: Update profile + profile picture upload

#### `/api/enrollments` - Student Enrollments
- **GET**: List student's enrollments
- **POST**: Enroll in course (free/paid + validation + coupon support)
  - Validates course, checks duplicate enrollment
  - For paid: requires payment proof (transaction ID, sender mobile)
  - Creates enrollment_application record
  - Handles coupon discount calculation

#### `/api/exams/[id]` - Exam Taking
- **GET**: Fetch exam + sanitized questions (no correct answers)
- **POST**: Submit exam attempt (answers stored server-side)
  - Validates access (auth, exam published, within window)
  - Handles attempt limits, device locks, session management
  - Computes score with negative marking & second-timer penalties

#### `/api/exams/mine` - Student's Exams
- **GET**: List exams student can/has taken

#### `/api/public-exams` - Public Exam Listing
- **GET**: List public exams by category
- **Filter support**: Subject, batch, mode

#### `/api/qa` - Q&A Forum
- **GET**: Browse questions by subject
- **POST**: Ask a question (requires paid enrollment validation)
  - Category + Course + Subject validation
  - Image attachment support
  - No audio submissions allowed

#### `/api/reviews` - Student Reviews
- **GET**: Public reviews (published only)

#### `/api/courses` - Course Listing
- **GET**: List courses (static catalog + dynamic db)

#### `/api/coupons` - Coupon Validation
- **POST**: Validate coupon code for enrollment

---

### Admin APIs (`/api/admin/*`)

#### `/api/admin` - Admin Gate
- **GET**: Check if user is admin, return role + permissions

#### `/api/admin/courses` - Course Management
- **GET**: List all courses
- **POST**: Create course
- **PUT**: Update course (with validation)
- **DELETE**: Delete course

#### `/api/admin/exams` - Exam Management
- **GET**: List exams (filtering by kind, status)
- **POST**: Create exam
- **PUT**: Update exam + publish
- **DELETE**: Delete exam
- **Exam question management**: Add/remove questions from bank or exam

#### `/api/admin/students` - Student Management
- **GET**: List students with filters
- **PUT**: Update student (name, institution, etc.)
- **GET enrollment applications**: Paid course validation queue

#### `/api/admin/enrollments` - Enrollment Approval
- **GET**: List pending applications
- **PUT**: Approve/reject enrollment

#### `/api/admin/qa` - Q&A Moderation
- **GET**: List unanswered questions
- **POST**: Add teacher answer
- **DELETE**: Delete question

#### `/api/admin/media` - File Management
- **POST**: Upload media (logo, banners, course images, etc.)
- **DELETE**: Delete media files

#### `/api/admin/notifications` - Notifications
- **POST**: Send push notifications to students
- **GET**: Notification history

#### `/api/admin/coupons` - Coupon Management
- **GET**: List coupons
- **POST**: Create coupon
- **PUT**: Update coupon
- **DELETE**: Delete coupon

#### `/api/admin/roles` - Role Management
- **GET**: List admin roles + permissions
- **POST**: Create role
- **PUT**: Update role
- **PUT**: Assign role to admin

#### `/api/admin/profile` - Admin Profile
- **GET**: Admin's own profile
- **PATCH**: Update profile + avatar

---

## 📦 Library Files (120+ files for business logic)

### Authentication & Authorization
- `auth-context.tsx` - React context for Firebase auth
- `auth-api.ts` - Token verification from Bearer header
- `admin.ts` - Admin gates (requireAdmin, requirePermission)
- `administration.ts` - Admin accounts, roles, activity logs

### Courses
- `courses.ts` - Course types (Batch, CourseType, CourseDetails, Course)
- `course-catalog.ts` - Live course catalog fetching
- `course-content.ts` - Layout types (Flow 1-5)
- `course-categories-store.ts` - Category data access
- `course-filters.ts` - Filtering logic
- `featured-courses.ts` - Featured/promoted courses
- `courses-admin.ts` - Admin course operations
- `category-courses-client.ts` - Client category access

### Exams
- `exams-admin.ts` - Exam CRUD + admin operations (200+ lines)
- `exam-taking.ts` - Student exam experience (scoring, negatives, second-timer)
- `exam-lifecycle.ts` - Exam state (Upcoming/Live/Closed/Hidden)
- `exam-rules.ts` - Rule templates (medical, academic, university)
- `exam-variants.ts` - Question versioning (Bangla/English)
- `public-exam-access.ts` - Public exam access control
- `public-exams-server.ts` - Exam page data fetching

### Enrollments
- `enrollments.ts` - Enrollment types + fetching
- `enrollments-admin.ts` - Admin enrollment operations
- `enrollment-applications.ts` - Paid course application workflow
- `enrollment-approval.ts` - Approval logic

### Q&A
- `qa.ts` - Q&A types (QaQuestion, QaAnswer, QaSubject)
- `qa-store.ts` - Q&A data access (fetch, insert, answers)

### Content Management
- `content-control.ts` - Admin control over course structure
- `content-admin.ts` - Jersey gallery, active content

### Website & Branding
- `website-settings.ts` - Global site config
- `hero-settings.ts` - Hero section customization
- `theme-settings.ts` - Light/dark theme + color customization
- `navbar.ts` - Navigation config (menu items, logo, layout)
- `seo-settings.ts` - Meta tags + OpenGraph
- `logo-store.ts` - Logo management (active + theme variants)
- `logo-background.ts` - Logo background images

### Marketing & Promotions
- `reviews-store.ts` - Published student reviews
- `faq-store.ts` - Published FAQs
- `banners.ts` - Homepage banners
- `banner-slides.ts` - Banner carousel
- `mentors.ts` - Mentor profiles
- `promotions.ts` - Promotional campaigns
- `coupons.ts` - Coupon validation + discount calculation
- `payment-card.ts` - Enrollment payment card display

### Database & Infrastructure
- `mysql.ts` - Connection pool + query helpers (LRU cache, transaction support)
- `firebase.ts` - Client Firebase config
- `firebase-admin.ts` - Admin SDK + token verification
- `storage.ts` - Media upload/delete (VM integration)
- `api-cache.ts` - Response caching helpers

### Dashboard & Home
- `dashboard.tsx` - Student dashboard component
- `dashboard-cards.ts` - Card configurations
- `glance-stats.ts` - Statistics for homepage
- `home-cards.ts` - Home section card configs
- `homepage-sections.ts` - Dynamic homepage sections
- `homepage-courses.ts` - Featured courses on home

---

## 🎨 Component Architecture

### Layout Components
- `Navbar.tsx` - Top navigation (logo, menu, auth button, notifications)
- `Footer.tsx` - Site footer (links, social, contact)
- `BottomNav.tsx` - Mobile bottom navigation
- `Logo.tsx` - Branding logo (with theme variants)
- `ThemeProvider.tsx` - Dark/light theme context

### Home Page Components (`components/home/`)
- `Hero.tsx` - Hero banner with CTA
- `FeaturedCourses.tsx` - Featured courses carousel
- `BannerSlider.tsx` - Rotating banners
- `Mentors.tsx` - Mentor profiles gallery
- `StudentReviews.tsx` - Testimonial carousel
- `FaqSection.tsx` - FAQ accordion
- `GlanceSection.tsx` - Stats display
- `WhyMediSpark.tsx` - Why choose us section
- `JerseyGallery.tsx` - Media gallery
- `JoinWithUs.tsx` - Social links CTA
- `AnnouncementBar.tsx` - Top announcement

### Course Components
- `CourseCard.tsx` - Course preview card
- `CoursesView.tsx` - Course list layout
- `CategoryCard.tsx` - Category preview
- `ExamCard.tsx` - Exam preview card
- `ExamCategoryCards.tsx` - Exam category grid
- `BatchCourseList.tsx` - Batch filter view

### Exam Components
- `ExamLockContext.tsx` - Prevents navigation during exam
- `ExamRulesGate.tsx` - Rules acceptance before start
- `StartExamButton.tsx` - Exam start UI
- `ExamResultClient.tsx` - Result display
- `TimerSelection.tsx` - Timer choice interface

### Q&A Components
- `QaExplorer.tsx` - Q&A browsing interface
- `QaAskForm.tsx` - Question submission form
- `QaAnswer.tsx` - Answer display
- `QaQuestionItem.tsx` - Question list item
- `QaSubjectPicker.tsx` - Subject selector
- `QaGuideline.tsx` - Guidelines modal

### Admin Components (`components/admin/`)
- `AdminShell.tsx` - Admin layout wrapper
- `AdminPageHeader.tsx` - Admin page header
- `CourseManager.tsx` - Course CRUD interface
- `ExamManager.tsx` - Exam CRUD + management
- `ExamQuestions.tsx` - Question bank editor
- `FaqManager.tsx` - FAQ management
- `LogoManager.tsx` - Logo upload + theme variants
- `MediaUploadField.tsx` - Reusable upload UI
- `PushManager.tsx` - Push notification sending
- `PromotionManager.tsx` - Coupon + promotion management
- `StudentCategoryCards.tsx` - Student stats
- `EnrollmentControlShared.tsx` - Enrollment settings

---

## 🔄 Data Flow Examples

### Student Registration & Login
```
1. User clicks "Continue with Google"
2. Firebase Google Sign-In popup/redirect
3. Token stored in browserLocalPersistence
4. Client calls /api/me (with Bearer token)
5. Server verifies token via Firebase Admin
6. Returns StudentProfile or null
7. AuthContext updates with profile + enrollments
8. UI adjusts (show dashboard, hide login, etc.)
```

### Course Enrollment (Paid)
```
1. Student clicks "Enroll"
2. App validates: course exists, user not enrolled, coupon (if provided)
3. POST /api/enrollments with payment proof:
   - transactionId (4-64 chars), senderMobile (01XXXXXXXXX format)
   - paymentMethod (bkash/nagad), couponCode (optional)
4. Server validates:
   - Student registered (row in `students` table)
   - Course exists (static catalog or `catalog_courses`)
   - No active enrollment for this course
   - Transaction ID unique
   - One pending application max per course
   - Coupon valid + discount calculated
5. Creates `enrollment` row (status: pending)
6. Creates `enrollment_application` record (payment proof)
7. Admin manually approves → enrollment_status = active
8. Student can now access course content
```

### Exam Taking
```
1. Student views exam details page (published, within window)
2. Reads exam rules, selects language (Bangla/English)
3. Clicks "Start Exam"
4. GET /api/exams/[id]?start=1&version=bangla
5. Server validates:
   - User authenticated
   - Exam published + active
   - Within exam window (lifecycle gate)
   - Attempt limit not exceeded
6. Creates `exam_attempt` (status: in_progress)
7. Creates `exam_session` (device tracking)
8. Returns exam with sanitized questions (no correct answers)
9. Student answers questions (client-side state, no submission yet)
10. Timer runs down or student submits
11. POST to submit: all answers sent to server
12. Server locks answers (no re-answer), calculates score:
    - Marks = (correct * marks) - (wrong * negative_per_wrong)
    - If second_timer_enabled: deduct % for repeat attempt
13. Creates `exam_result` + inserts into `exam_rankings`
14. Student sees result page with score, rank, certificate (if eligible)
```

### Q&A Question Submission
```
1. Student (with active paid enrollment) clicks "Ask a Question"
2. Fills form: Category → Course → Subject → Question Text + (optional) image
3. POST /api/qa with data
4. Server validates:
   - User authenticated
   - Enrolled in the submitted course (active)
   - Has at least one active paid enrollment (gate)
   - Course belongs to category
   - Subject belongs to course
   - Text 5–2000 chars
   - Image URL valid (if provided)
5. Inserts `qa_question` record
6. Question appears in browse view (status: unanswered)
7. Admin can answer via Admin Panel → Q&A
8. POST /api/admin/qa with answer
9. Creates `qa_answer` record, question status → answered
10. Student notified (if notification enabled)
```

---

## 🔒 Security Features

### Database Security
- **TLS Enforced**: Azure MySQL requires TLS connection
- **Connection Pooling**: 8 concurrent connections max (prevents exhaustion)
- **Prepared Statements**: Using placeholders (mysql2 escaping)
- **Transactions**: `withTransaction()` for atomic operations

### API Security
- **Firebase Token Verification**: All user APIs require valid Bearer token
- **Admin Authorization**: UID/email matching + role-based gates
- **Email Verification**: Only verified emails trusted for admin fallback
- **Activity Logging**: All admin actions logged to `admin_activity_logs`
- **Coupon Validation**: Server-side recalculation (never trust client discount)
- **Transaction ID Uniqueness**: Prevents duplicate payment applications
- **Input Validation**: Comprehensive checks on all user inputs

### Media Security
- **VM-Hosted Files**: Not stored in database (except legacy blobs)
- **Token-Authenticated Uploads**: MEDIA_UPLOAD_TOKEN required
- **MIME Type Detection**: Based on file extension
- **File Deletion**: Cleanup on media changes

### Exam Security
- **Answer Locking**: Correct answers never sent to client during exam
- **Session Tracking**: Device changes auto-submit previous session
- **Attempt Limits**: Per-exam configuration
- **Time Gates**: Exam window validation (published, within dates)

---

## 🎯 Main Features

### For Students

1. **Course Catalog**
   - Browse by category (SSC/HSC/Medical/Varsity)
   - Filter by batch
   - View course details, teacher info, duration
   - Free & paid courses

2. **Enrollments**
   - Instant free enrollment
   - Paid enrollment with payment proof (bkash/nagad)
   - Coupon support
   - Application workflow (pending → active)

3. **Exams**
   - Public exams (open to all)
   - Course exams (only enrolled students)
   - Live vs practice modes
   - Attempts with time limits
   - Negative marking (configurable)
   - Leaderboards & rankings
   - Result certificates (if qualified)

4. **Q&A Forum**
   - Ask questions (requires paid enrollment)
   - Teacher-answered (async model)
   - Subject-based browsing
   - Image attachments
   - Notification when answered

5. **Profile & Dashboard**
   - Edit name, institution, avatar
   - View enrollments
   - Track exam results
   - Learning progress
   - Notifications

6. **Homepage**
   - Dynamic sections (admin-configurable)
   - Featured courses
   - Student reviews
   - Mentor profiles
   - FAQs
   - Announcements
   - Promotions

### For Admins

1. **Course Management**
   - Create/edit/delete courses
   - Upload banner images
   - Add teachers, duration, fees
   - Publish/unpublish
   - Category assignments
   - Batch management

2. **Exam Management**
   - Create exams with question bank
   - Add/remove/edit questions
   - Set rules (negative marking, second-timer)
   - Publish + set exam window (start/end times)
   - View leaderboards + results
   - Generate certificates
   - Export results

3. **Student Management**
   - List all students
   - View profiles
   - Search/filter
   - View enrollment history
   - Check payment applications
   - Approve/reject enrollments

4. **Q&A Moderation**
   - List all questions (answered/unanswered)
   - Add/edit answers
   - Delete inappropriate questions

5. **Content Control**
   - Homepage section visibility
   - Featured courses list
   - Jersey gallery
   - Announcements
   - Home cards

6. **Website Customization**
   - Site title, meta tags, favicon
   - Hero section content + image
   - Theme (light/dark) + colors
   - Navbar menu items
   - Footer links, social links
   - Logo upload (theme variants)
   - SEO settings

7. **Marketing**
   - Coupon creation + limits
   - Promotions/campaigns
   - Student reviews (publish/reject)
   - FAQs management

8. **Administration**
   - Add/remove admin users
   - Role assignments (admin / custom roles)
   - Permissions per role
   - Activity audit logs

9. **Settings & System**
   - Enrollment control (free auto-approve)
   - Exam settings (global attempt limit)
   - Payment settings
   - Enrollment applications queue
   - Backup & restore
   - Database migrations
   - Push notifications

---

## 📊 Data Models Summary

### User Types
1. **Student**: Registered via Google → profile in `students` table
2. **Admin**: UID in `admins` table → role + permissions

### Course Types
- Academic (SSC/HSC)
- Admission (Medical/Varsity)

### Exam Kinds
- **public**: Visible to all, anyone can attempt
- **practice**: No time limit, practice mode
- **enrolled**: Only enrolled students, course-locked

### Enrollment States
- **pending**: Paid courses awaiting admin approval
- **active**: Student can access course content
- **cancelled**: Student unenrolled
- **completed**: Course finished

### Exam States
- **draft**: Work-in-progress, not visible
- **published**: Live/visible to students
- **closed**: No new attempts allowed

---

## 🚀 Deployment & Infrastructure

### Frontend
- **Vercel** (auto-deploy on main push)
- Environment variables stored in Vercel dashboard
- Next.js 16 standalone output

### Database
- **VM MariaDB 10.6** (self-hosted on `medispark`)
- Host: `<DB_HOST>:3306`
- Database: `<DB_NAME>`
- Non-TLS, persistent + nightly backups
- Schema managed via SQL migrations (`src/sql/*.sql`)

### Media Storage
- **Self-hosted media server**
- nginx serves the uploads directory
- Token-authenticated upload service on localhost
- Legacy uploads table stores old binary blobs

### Authentication
- **Firebase project**: `<FIREBASE_PROJECT>`
- Google OAuth provider configured
- Admin SDK credentials in environment

---

## 🔧 Environment Variables

### Required (Set in Vercel or `.env`)

**Database**
```
MYSQL_HOST=<DB_HOST>
MYSQL_PORT=3306
MYSQL_DATABASE=<DB_NAME>
MYSQL_USER=<admin>
MYSQL_PASSWORD=<secret>
```

**Firebase Web (public)**
```
NEXT_PUBLIC_FIREBASE_API_KEY=<key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<domain>
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<FIREBASE_PROJECT>
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<bucket>
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<id>
NEXT_PUBLIC_FIREBASE_APP_ID=<id>
NEXT_PUBLIC_FIREBASE_VAPID_KEY=<vapid>
```

**Firebase Admin (server-side)**
```
FIREBASE_PROJECT_ID=<FIREBASE_PROJECT>
FIREBASE_CLIENT_EMAIL=<service-account-email>
FIREBASE_PRIVATE_KEY=<private-key>
# OR
FIREBASE_SERVICE_ACCOUNT_JSON=<full-json>
```

**Media Upload**
```
MEDIA_UPLOAD_TOKEN=<shared-secret>
MEDIA_FILES_BASE_URL=https://<MEDIA_HOST>/medifiles
MEDIA_UPLOAD_URL=https://<MEDIA_HOST>/medifiles-upload
MEDIA_DELETE_URL=https://<MEDIA_HOST>/medifiles-delete
```

**Optional**
```
NEXT_PUBLIC_SITE_URL=https://medisparkbd.com (default)
MYSQL_SSL=false (for VM MariaDB)
```

---

## 📝 Development Workflow

### Setup
```bash
pnpm install
cp .env.example .env  # Fill in credentials
pnpm dev              # http://localhost:3000
```

### Database Migrations
1. Create a new SQL file in `src/sql/<name>-migration.sql`
2. Apply to VM MariaDB:
   ```bash
   mysql -h <DB_HOST> -u <admin> -p <DB_NAME> < src/sql/<file>.sql
   ```

### Type Checking
```bash
npx tsc --noEmit  # Full typecheck
```

### Production Build
```bash
pnpm build
vercel --prod  # Manual deploy (usually Vercel auto-deploys)
```

### Key Rules
- **Never force-push** to main
- **Secrets never in code** (only environment)
- **SQL migrations are additive** (no destructive deletes of existing tables)
- **All user APIs require auth** (Bearer token validation)
- **Admin APIs require permission checks**

---

## 📚 File Naming & Organization Conventions

### Library Files
- `*-admin.ts` - Admin-facing operations (e.g., `courses-admin.ts`)
- `*-store.ts` - Data access layer (e.g., `qa-store.ts`)
- `*-context.tsx` - React context providers
- `*-settings.ts` - Configuration/customization
- Plain utility files have no suffix (e.g., `storage.ts`, `mysql.ts`)

### Components
- PascalCase filename = React component export
- Folder per feature group (e.g., `admin/`, `home/`, `exam/`)
- `index.ts` for re-exports

### API Routes
- Folder per resource (e.g., `/api/courses/`, `/api/admin/`)
- `route.ts` is the handler file (GET, POST, PATCH, DELETE)
- Dynamic segments in brackets: `[id]/route.ts`

### SQL Migrations
- Filename pattern: `<feature>-migration.sql`
- Include comments explaining the change
- Additive only (don't delete existing tables)

---

## 🎓 Key Architectural Patterns

### 1. **Unified Exam Engine**
- Single codebase powers PUBLIC and COURSE exams
- `kind` (public/practice/enrolled) is the source of truth
- Access control is a layer on top, not part of the engine

### 2. **Server-Side Answer Locking**
- Correct answers never sent to client
- Questions sanitized before JSON response
- All scoring happens server-side post-submission

### 3. **Flow-Based Course Content**
- Courses support multiple layouts (Flow 1–5)
- Flow 1 = Direct content (subject → chapters)
- Flow 5 = Exam-centric (chapters → exams + content)
- Admin chooses per-course

### 4. **Admin Authorization Resilience**
- Dual-key lookup: UID + email fallback
- Survives Firebase project changes
- Email must be verified for fallback trust

### 5. **Lazy Table Creation**
- Tables auto-created on first use (idempotent `CREATE TABLE IF NOT EXISTS`)
- `ensureColumn()` for backward-compatible schema evolution
- No manual migrations required for deployment

### 6. **Query Caching**
- In-memory LRU cache (500 entry max, 5s TTL default)
- Only SELECT queries cached
- Auto-invalidated on INSERT/UPDATE/DELETE

### 7. **Transactional Enrollments**
- Payment applications created alongside enrollment row
- Atomic operations prevent inconsistencies
- Row locks (`SELECT ... FOR UPDATE`) for race condition prevention

### 8. **Push Notification Model**
- Tokens stored in `push_tokens` table
- Admin sends bulk notifications to student segments
- Best-effort delivery (no retry logic)

---

## 🔗 Integration Points & External Services

### Firebase (<FIREBASE_PROJECT> project)
- **Google Sign-In**: `signInWithPopup()` / `signInWithRedirect()`
- **Token Verification**: `getAuth().verifyIdToken(token)`
- **UID is primary key**: for all student/admin lookups

### Azure MySQL (managed)
- **Connection via TLS**: Required by Azure policy
- **GIPK enabled**: Invisible primary keys on tables without explicit PKs
- **No SSH tunneling**: Direct HTTPS/TLS connection from Vercel

### Media VM (<MEDIA_HOST>)
- **Upload endpoint**: POST with `X-Medifiles-Token` header
- **Delete endpoint**: POST JSON with full URL
- **Serve endpoint**: nginx static files at `/medifiles/`
- **Fallback**: Legacy `/api/files/<id>` reads from MySQL LONGBLOB column

---

## 📈 Scalability Considerations

### Current Setup
- Connection pooling: 8 connections max (Vercel serverless friendly)
- Query cache: 500 entries, 5s TTL (reduces DB load)
- No persistent server state (fully stateless)

### Potential Bottlenecks
- Exam leaderboard queries (millions of results)
- Admin dashboard with many students (pagination needed)
- Large file uploads (limited by HTTP body size)

### Optimization Strategies
- Database indexes on common filters (already applied)
- Pagination on admin list views
- Async scoring (can defer ranking calculations)
- CDN caching for static assets (Next.js built-in)
- Batch notifications instead of per-student operations

---

## 🐛 Known Limitations & Tech Debt

1. **SQL Migrations Manual**: Migrations must be applied manually to Azure
2. **No API Rate Limiting**: DDoS risk; consider Vercel limits
3. **Audio Questions Removed**: Legacy code still references audio submission
4. **PDF Material Support**: Partial implementation (legacy `pdf_materials` table)
5. **Flow 1–5 Naming Confusion**: Flow 5 labeled as "Course Flow 4" in UI
6. **No Built-in Backup**: Manual MySQL backups required
7. **Student ID Format**: MS-XXXXXXXX generated locally; not globally unique
8. **Second-Timer Logic**: Complex edge cases for repeat attempts

---

## 🎉 Summary

**MediSparkBD** is a comprehensive EdTech platform with:
- ✅ **Robust auth** (Firebase + dual-key admin fallback)
- ✅ **Complete exam system** (public + course exams, scoring, leaderboards)
- ✅ **Course catalog** (free + paid, coupons, enrollments)
- ✅ **Q&A forum** (async teacher-answered model)
- ✅ **Admin panel** (full content management)
- ✅ **Responsive UI** (mobile-first, dark/light themes)
- ✅ **Scalable architecture** (stateless, pooled connections, caching)
- ✅ **SQL migrations** (90+ files, GIPK-aware)

Perfect for HSC & medical admission prep targeting Bangladesh students.
