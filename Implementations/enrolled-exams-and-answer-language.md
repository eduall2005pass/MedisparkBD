# Enrolled exams shortcut, answer-sheet language and practice counts

## Deployment

Apply `src/sql/enrolled-exam-card-migration.sql` to the existing MySQL/MariaDB application database. It creates the keyed `global_settings` table and seeds `my_enrolled_exams` without overwriting existing admin settings. The stored JSON includes `is_active`, `title`, `subtitle`, and `icon`; writes record the admin UID and update timestamp. The application can also create this table lazily when missing, but deployments with restricted DDL privileges should apply the migration beforehand.

No package installation is required. Existing `exam_question_variants` and result language/set snapshot fields are reused; no duplicate English/Bengali schema is introduced.

## Student flow

`Explore Public Exams` shows the configurable shortcut above the four existing categories. It is not added to the admin's reusable category-card grid.

The shortcut opens `/exam/enrolled`. Anonymous students receive the normal login CTA, retaining the intended destination. Signed-in students see the current names and banners of their active enrollments. Pending/cancelled/completed enrollments and unpublished/deleted courses are excluded. Hidden but published courses remain accessible to active students, consistent with the existing course access rules.

An empty list shows **No enrolled courses found** and links to the existing premium catalog at `/courses?kind=paid`. Request failures show a retry state, not an empty enrollment state.

`GET /api/my/enrolled-exams` returns:

```json
{
  "enrolled_courses": [
    {
      "course_id": "course-slug",
      "course_name": "Course name",
      "banner_image_url": "/uploads/banner.webp",
      "direct_exam_route_url": "/dashboard/enrolled-courses/course-slug/course-exams"
    }
  ]
}
```

The API resolves the current catalog `content_layout`, rather than embedding per-course routing in the frontend:

| Layout | Exam section |
| --- | --- |
| Flow 5 | Existing `exam-flow` section |
| Flow 4 | New exam/quiz-only `flow4-exams` section using the existing direct-content API |
| Flows 1–3, auto and legacy layouts | New `course-exams` section, including both direct assignments and valid chapter-linked exams |

Selecting a banner re-fetches the API before navigation, rechecking enrollment and the latest layout. Legacy/Flow 4 exam sections also honor changed route metadata. Existing participation APIs still enforce entitlement; the shortcut does not grant access. Content and flow loaders bypass the MySQL SELECT cache, so edits are read from the database when the course section opens.

## Admin control

Open **Admin → Exam Settings** (`/admin/exams/settings`). The new section supports visibility, title, subtitle, a supported icon picker, live preview, save, and reset to defaults. Reset deletes the singleton override and restores the default visible card; turning the visibility toggle OFF is the way to hide it.

- Public read: `GET /api/public-exams/enrolled-card`.
- Admin read: `GET /api/admin/exams/enrolled-card`.
- Create/update: `PUT /api/admin/exams/enrolled-card` with the complete settings object.
- Delete/reset: `DELETE /api/admin/exams/enrolled-card`.

Admin APIs require the existing `manageExams` or `managePublicExam` permission. Writes validate input and are audit logged. Icons are whitelisted identifiers, not executable SVG/HTML. Responses are `no-store`; database failures do not silently restore a hidden card to an enabled default.

Settings refresh on mount, focus/visibility return, and every minute while visible. Same-browser admin saves also notify other tabs. This is polling-based synchronization, not a new WebSocket service.

## Answer-sheet language

The existing engine locks `bangla`/`english` at session start. Submission outcomes carry that medium, and result-save fallback inserts preserve the language/set/order snapshot even on the existing legacy `attempt_type` enum schema.

`GET /api/exams/[id]/result?exam_version=en` or `?exam_version=bn` validates the hint and reads only the authenticated student's submitted result. A persisted language snapshot takes precedence over a conflicting URL. The hint is used only for older results missing that snapshot.

Both answer-sheet clients request and display the resolved medium. Question text, options, explanations, and authored keys come from the same language/set cell in `exam_question_variants`. Stored grading-time correct answers and marks remain authoritative. A missing translation is explicitly labelled as original-content fallback; empty variant placeholders produce an unavailable notice instead of arbitrarily selecting another language/set. English/Bengali translations are still authored through the existing admin paper editor.

**Historical limitation:** the original medium of a result with no persisted language cannot be reliably reconstructed. Existing links without a hint retain the legacy Bangla default; an explicit `exam_version=en` hint can display authored English content for such results. Missing authored translations must be supplied in the admin editor. Neither an unknown historical medium nor missing translations are fabricated by this change.

## Practice counts

`GET /api/public-exams/live-counts` retains its existing `{ counts, practiceCounts }` response contract. A fresh grouped SQL query counts published public/practice exams by the exact category ID. It includes static practice, legacy `kind = 'practice'`, and eligible live exams after their end time. Draft, closed, explicitly archived, and course-enrolled exams are excluded.

The card renders `{count} Practice Exams Available` when nonzero, otherwise `No Practice Exams Available`. Fresh counts are fetched on mount, focus/visibility return and every minute while visible; the `/exam` page also gets uncached first-render counts. Add/delete/publish/draft changes and live-to-practice time transitions therefore update without manually maintaining counters. Database failures return 503 instead of successful zero counts.

## Validation

Regression suites cover settings validation/authorization/persistence, enrollment ownership/routing, complete isolated course exam selection, Flow 4/5 freshness, language/set replay and legacy submission retry, and practice-count lifecycle/mutations. Tests use mocked authentication/database boundaries and isolated SQLite fixtures; they do not mutate the deployment database. Run:

```sh
node --experimental-strip-types --test tests/enrolled-exam-card.test.ts tests/enrolled-exams.test.ts tests/enrolled-exams-course.test.ts tests/exam-result-language.test.ts tests/public-exam-counts.test.ts tests/admin-authorization.test.ts tests/exam-autosync.test.ts
```

Authenticated browser smoke tests and applying the migration on the deployment database remain deployment checks.
