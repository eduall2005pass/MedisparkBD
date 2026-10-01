# MediSpark (medisparkbd.com)

HSC academic & medical admission preparation platform for Bangladeshi students —
courses, live/practice exams, Q&A, and a full admin control panel in one app.

- **Live:** https://medisparkbd.com (also www) — HTTP 200, title
  "MediSpark Academic & Admission Care". Vercel project `medisparkbd`,
  auto-deploys on push to `main`.
- **Stack:** Next.js 16.3.1 (App Router) + React 19 + TypeScript 5 (strict) +
  Tailwind CSS v4. 137 API routes, 91 SQL migrations, 40+ admin sections.

## Architecture

| Layer | Service |
|---|---|
| Web app | Vercel — project `medisparkbd` (auto-deploys on push to `main`) |
| Database | Self-hosted MariaDB (`MYSQL_HOST`:`MYSQL_PORT`, non-TLS, nightly backups) |
| Media files | Self-hosted media server (`MEDIA_FILES_BASE_URL`) — nginx serves uploaded files, private upload service on localhost |
| Auth | Firebase (Google sign-in, project `<FIREBASE_PROJECT>`) |

- All application data lives in **MySQL** (VM). No Firestore/Supabase/local-disk storage.
- Uploaded media (logo, banners, course images, profile pictures, audio) live on the
  VM disk; only their URL is stored in MySQL. Legacy `/api/files/<id>` route still
  serves a few old rows from the `uploads` table.
- Admin authorization = row in the `admins` table. Matching is by Firebase UID **or**
  verified email (see `src/lib/admin.ts`) so access survives Firebase project changes.
- 10-permission matrix (`src/lib/admin-access.ts`): admin 10, moderator 9,
  teacher 6 teaching/content permissions. Unknown roles fail closed (deny).

## Features

### Student platform
- **Home** (`/`): hero, announcements, featured courses/slides, mentors, reviews,
  FAQs, promos — all controllable from admin Home Control / Website settings.
- **Course catalog** (`/courses`): filter by category (SSC/HSC Academic, Medical /
  Varsity Admission) and batch (HSC 28/27/26, SSC 28/27/26); free vs paid.
- **Enrolled courses dashboard**: subjects → papers → chapters → classes/materials,
  exam flows (live / topic-wise / format-wise), course progress, continue-learning,
  favourites, recently-viewed, notifications, profile.
- **Exam taking** (`/exam/[id]`): timer page, locked shuffled question order,
  claim-first submit, negative marking (0.25 for Admission), offline snapshots,
  result board (`/result`, `/dashboard/exam-result/...`).
- **Public exams**: upcoming / live / practice phases; post-live practice retakes
  are unranked. Enrolled (course) exams: upcoming → live → archived(practice).
- **Q&A forum** (`/qa`): ask questions with images (8 MB cap, magic-byte checked,
  10 uploads / 10 min rate limit), mentor answers.
- **Auth** (`/login`, `/register`): Google sign-in (popup + redirect), race-safe
  profile/enrollment loading, shared-device logout clears offline cache.
- **PWA**: `sw.js` + `firebase-messaging-sw.js` (no-cache headers), web push
  via VAPID, installable manifest.

### Enrollment & payments
- `POST /api/enrollments`: server-side repricing (client fee never trusted),
  coupon re-validation + usage-cap guard inside one transaction (enrollment row +
  application row + coupon count all commit or all roll back), bKash/Nagad
  transaction-ID dedupe, unpublished/hidden courses rejected.
- Free-course auto-enrollment toggleable from Enrollment Control.

### Exam engine & variants
- Question versions/sets (e.g. Bangla/English × Set Ka/Kha): variant content wins,
  corrupt variant cells fall back to pure base rows (never mixed). Grading resolves
  through the same path, so displayed answers = graded answers.
- Admin paper editor with paste-MCQ parser (Bangla digits, 4-option key bounds).

### Material PDF (`/admin/material-pdf`)
- Build CQ/MCQ PDFs (A4) from uploaded exams with pagination utils, watermark
  logo, scale-to-fit mobile preview, full-res capture via `jspdf` + `html2canvas`.

### Admin panel (`/admin`, 40+ sections)
Course Control, Course Content, Enrolled Courses, Course Exams, Public Exam +
Public Exam Control, Material PDF, Enrollment Control, Student Control, Students,
QA + QA Control, Result Control, Exam Rules, Notification Control, Marketing
(coupons, promos, banners, featured), Mentors, Finance, Administration activity
log, Branding/Website/Homepage controls, Settings, System.

### Finance (`/finance` + `/api/finance/*`)
Manual costs/income, monthly + summary aggregates, audit trail, CSV export —
all gated by `manageSystem`/`manageCourses`, 401 (unauthenticated) vs 403
(no permission) split, soft deletes.

### Student direct contact (Student Control)
- Per-student WhatsApp (`wa.me`) + Telegram (`t.me/+`) deep-link buttons —
BD numbers auto-normalized (`01…`/`+880…` → `880…`), greeting prefilled
(`src/lib/student-contact.ts`, `src/components/admin/StudentContactButtons.tsx`).
- Bulk Telegram onboarding: **vCard (`.vcf`) export** of the current view
(tab + course filter, deduped) → import into phone contacts → Telegram
contact-sync → group **Add Members**. The panel includes a Bangla step-by-step
guide; group invite links are copied from Telegram itself (never hardcoded).

## Vercel usage optimization (200K quota, ~100 students)

Two cost types: **global/shared** (ISR/Data-Cache writes — same for 10 or 1000
users) vs **per-tab** (function invocations — multiplies per open tab).
All client polling follows one rule: **visible tabs only**
(`src/lib/use-visible-interval.ts` — hidden tabs cost zero).

| Area | Policy |
|---|---|
| Layout caches (logo 3600s, seo/settings/navbar/theme 1800s) | Long TTL + instant `revalidateTag` on admin save (`/api/logo`, `/api/seo-settings`, `/api/website-settings`, `/api/navbar-settings`, `/api/theme-settings`) |
| Exam/category caches (`publicExams`, counts, categories) | 600s TTL, tag-busted on admin save |
| Pages (`/`, `/exam`, category, `/result`) | `revalidate = 300` |
| Homepage course cards | No polling — SSR count + mount fetch + tab-focus refetch |
| Navbar unread dot | 10-min visible-only poll + instant read-event/focus refetch |
| Result board | 5-min visible-only silent refresh + manual button (DB-direct, `no-store` both sides) |
| Exam category pages | 10-min visible-only refresh via DB-direct `/api/public-exams/list` (`NO_CACHE`), filters/tabs preserved |
| `LogoProvider` | No mount/focus auto-refetch (SSR props are truth); `refresh()` only after admin upload, with edge cache-buster |

Budget math (100 students × 2 hr/day × 30 days = 6000 tab-hours):
polling ≈ 50–60K invocations/month, leaving ~140K headroom for page
views/API calls inside a 200K quota. Exam-day spikes are normal (average
is what matters). Watch **Vercel → Usage → Function Invocations**.

## Repository / deploy flow

- Single repo: `medisparkbd/MediSparkBD` — every push to `main` auto-deploys to Vercel (when linked) and runs against the self-hosted MariaDB (persistent, see `deploy/vm-mysql-migration.md`) + media server.
- **Never force-push.** If a push is rejected: `git pull --rebase medisparkbd main` first, then push again.

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in credentials (never commit .env)
pnpm dev               # http://localhost:3000
```

Useful commands:

```bash
npx tsc --noEmit   # typecheck (rm -rf .next first if stale errors appear)
npm test           # 19 authorization tests (node --experimental-strip-types)
pnpm build         # production build
vercel --prod      # manual production deploy (usually not needed)
npx eslint src/lib src/app/api  # lint (0 errors expected)
```

## Environment variables

Set locally in `.env`, in production via Vercel project settings:

| Variable | Purpose |
|---|---|
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | MySQL connection (self-hosted). Set `MYSQL_SSL=false` (see `src/lib/mysql.ts:40`) |
| `NEXT_PUBLIC_FIREBASE_API_KEY` … | Firebase web config (project `<FIREBASE_PROJECT>`) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Firebase Admin (token verification) |
| `MEDIA_UPLOAD_TOKEN` | Shared secret between app and the VM upload service |
| `MEDIA_FILES_BASE_URL` / `MEDIA_UPLOAD_URL` / `MEDIA_DELETE_URL` | Media endpoints (self-hosted media server) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web push notifications |

Secrets live outside the repo (local `.env` / Vercel dashboard). **Never commit them.**

## Database schema

Schema and migrations live in `src/sql/*.sql` (91 files). After changing the schema:

1. Add/update a migration file in `src/sql/`
2. Apply it on the database server:

   ```bash
   # direct:
   mysql -h <DB_HOST> -P 3306 -u <DB_USER> -p <DB_NAME> < src/sql/<file>.sql
   # tunnel fallback: ssh -L 3309:localhost:3306 -N <SSH_USER>@<DB_HOST> &; mysql -h 127.0.0.1 -P 3309 ...
   ```

Note: tables use `uq_<table>_pk` UNIQUE indexes; follow that pattern for new tables.

## Key source paths

- `src/lib/mysql.ts` — DB pool + query helpers (transient retry, bounded SELECT cache, `withTransaction` invalidates cache on commit)
- `src/lib/storage.ts` — media save/delete (22-dir allowlist, SVG sanitize, magic bytes, default-deny)
- `src/lib/admin.ts` / `src/lib/admin-access.ts` — admin auth gates + permission matrix
- `src/lib/exam-taking.ts` / `src/lib/exam-variants.ts` — taking + version/set resolution (shared by display and grading)
- `src/lib/enrolled-exam-lifecycle.ts` — course-exam lifecycle (draft/closed/upcoming/live/archived/practice/no-window)
- `src/lib/auth-context.tsx` — client auth state (stale-generation guards, `allSettled` loads)
- `src/app/api/enrollments/route.ts` — transactional enrollment + coupon + txn-id dedupe
- `server/medifiles-server.mjs` + `deploy/*` — VM-side file service & nginx config

## Docs

- `API_REFERENCE.md` — endpoint reference (auth, public + admin APIs)
- `CODEBASE_SUMMARY.md` / `FILE_LISTING.md` — module inventory
- `EXECUTIVE_SUMMARY.md` / `DOCUMENTATION_INDEX.md` — overviews
- `deploy/vm-mysql-migration.md` — database migration notes
