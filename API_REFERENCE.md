# MediSparkBD API Reference

## Authentication

All API endpoints (except public ones) require a Bearer token from Firebase:

```
Authorization: Bearer <idToken>
```

Token is obtained from:
1. Client: `user.getIdToken()` after Firebase sign-in
2. Server: Verified via `getFirebaseUser(request)` from Bearer header

---

## Public APIs (No Auth Required)

### GET `/api/courses`
List courses from static catalog + database.

**Query Parameters**
- `category`: Filter by category (e.g., "HSC Academic")
- `batch`: Filter by batch (e.g., "hsc-28")

**Response**
```json
{
  "courses": [
    {
      "slug": "hsc-2024-biology",
      "name": "HSC 2024 Biology",
      "category": "HSC Academic",
      "batchId": "hsc-28",
      "image": "https://...",
      "shortDescription": "...",
      "fee": 5000,
      "discountFee": null,
      "status": "published",
      "availability": "available"
    }
  ]
}
```

---

### GET `/api/courses/category-counts`
Get course count per category.

**Response**
```json
{
  "counts": {
    "hsc-academic": 12,
    "medical-admission": 8,
    "varsity-admission": 5
  }
}
```

---

### GET `/api/public-exams`
List public exams by category.

**Query Parameters**
- `category`: Filter by exam category (e.g., "ssc-academic")
- `subject`: Filter by subject
- `batch`: Filter by batch

**Response**
```json
{
  "exams": [
    {
      "id": "exam-001",
      "title": "SSC Biology Mock Exam 1",
      "subject": "Biology",
      "batchId": "ssc-28",
      "totalMarks": 100,
      "durationMinutes": 60,
      "published": true,
      "examMode": "practice"
    }
  ]
}
```

---

### GET `/api/qa`
List Q&A questions (browse by subject).

**Query Parameters**
- `subject`: Subject ID to filter

**Response**
```json
{
  "subjects": [
    { "id": "bio-001", "name": "Biology", "order": 1 },
    { "id": "chem-001", "name": "Chemistry", "order": 2 }
  ],
  "questions": [
    {
      "id": "q-001",
      "subjectId": "bio-001",
      "studentName": "Imran",
      "text": "What is photosynthesis?",
      "status": "answered",
      "createdAt": "2024-01-15T10:30:00Z",
      "answer": {
        "id": "a-001",
        "teacherName": "Dr. Khan",
        "content": "Photosynthesis is...",
        "answeredAt": "2024-01-16T14:20:00Z"
      }
    }
  ]
}
```

---

### GET `/api/reviews`
List published student reviews.

**Response**
```json
{
  "reviews": [
    {
      "id": "rev-001",
      "studentName": "Fatima",
      "rating": 5,
      "courseName": "HSC Chemistry",
      "text": "Excellent course...",
      "status": "published"
    }
  ]
}
```

---

### GET `/api/faqs`
List published FAQs (if public endpoint exists).

**Response**
```json
{
  "faqs": [
    {
      "id": "faq-001",
      "question": "How do I enroll?",
      "answer": "You can enroll by...",
      "answerType": "text"
    }
  ]
}
```

---

### POST `/api/coupons/validate`
Validate a coupon code.

**Request**
```json
{
  "code": "SUMMER2024",
  "fee": 5000
}
```

**Response (Success)**
```json
{
  "valid": true,
  "coupon": {
    "code": "SUMMER2024",
    "discountType": "percent",
    "discountValue": 10,
    "discountedFee": 4500
  }
}
```

**Response (Error)**
```json
{
  "valid": false,
  "error": "Coupon not found or expired"
}
```

---

## Student APIs (Auth Required)

### GET `/api/me`
Get current student profile.

**Response**
```json
{
  "profile": {
    "uid": "firebase-uid-123",
    "studentId": "MS-A1B2C3D4",
    "fullName": "Imran Ahmed",
    "gender": "Male",
    "institution": "Dhaka College",
    "hscBatch": "2024",
    "contactNumber": "01712345678",
    "email": "imran@example.com",
    "facebookUrl": "https://facebook.com/imran",
    "profilePictureUrl": "https://...",
    "provider": "google",
    "createdAt": "2024-01-01T10:00:00Z"
  }
}
```

---

### POST `/api/me`
Register new student profile.

**Request**
```
FormData:
- fullName: "Imran Ahmed"
- gender: "Male"
- institution: "Dhaka College"
- hscBatch: "2024"
- contactNumber: "01712345678"
- email: "imran@example.com"
- facebookUrl: "https://facebook.com/imran"
- studentLevel: "HSC Academic"
- picture: <File> (optional)
```

**Response**
```json
{
  "profile": { /* student profile object */ }
}
```

---

### PATCH `/api/me`
Update student profile.

**Request**
```
FormData:
- fullName: "Imran Ahmed"
- institution: "Dhaka College"
- facebookUrl: "https://facebook.com/imran"
- picture: <File> (optional)
```

**Response**
```json
{
  "profile": { /* updated profile */ }
}
```

---

### GET `/api/enrollments`
List student's course enrollments.

**Response**
```json
{
  "enrollments": [
    {
      "studentUid": "uid-123",
      "courseId": "hsc-biology-001",
      "courseName": "HSC 2024 Biology",
      "courseType": "Academic",
      "courseKind": "paid",
      "fee": 5000,
      "enrollmentStatus": "active",
      "enrollmentDate": "2024-01-10T12:00:00Z",
      "updatedAt": "2024-01-10T12:00:00Z"
    }
  ]
}
```

---

### POST `/api/enrollments`
Enroll in a course (free or paid).

**Request**
```json
{
  "courseId": "hsc-biology-001",
  "courseName": "HSC 2024 Biology",
  "courseType": "Academic",
  "courseKind": "free",
  "fee": 0,
  "couponCode": "SUMMER2024"
}
```

**For Paid Courses (add)**
```json
{
  "courseId": "...",
  "courseKind": "paid",
  "fee": 5000,
  "transactionId": "TXN-123456789",
  "senderMobile": "01712345678",
  "paymentMethod": "bkash",
  "couponCode": "SUMMER2024"
}
```

**Response**
```json
{
  "enrollment": { /* enrollment object */ },
  "application": {
    "id": "app-001",
    "studentUid": "uid-123",
    "courseId": "course-id",
    "transactionId": "TXN-123456789",
    "paidAmount": 4500,
    "paymentMethod": "bkash",
    "status": "pending_validation",
    "createdAt": "2024-01-20T10:30:00Z"
  }
}
```

**Error Responses**
```json
{ "error": "You are already enrolled in this course." }
{ "error": "Invalid coupon code." }
{ "error": "Enter a valid Sender Mobile Number (e.g. 01XXXXXXXXX)." }
{ "error": "Complete your registration before enrolling." }
```

---

### GET `/api/exams/[id]`
Get exam details + sanitized questions (no correct answers).

**Query Parameters**
- `start`: "1" to start attempting the exam
- `timer`: "first" or "unlimited" (default: "first")
- `version`: "bangla" or "english" (default: "bangla")

**Response (Pre-start, meta only)**
```json
{
  "exam": {
    "id": "exam-001",
    "title": "Biology Mock Exam 1",
    "subject": "Biology",
    "totalMarks": 100,
    "durationMinutes": 60,
    "negativeMarks": 0.25,
    "rules": "Negative marking enabled for wrong answers"
  }
}
```

**Response (After ?start=1, with questions)**
```json
{
  "exam": { /* exam meta */ },
  "attempt": {
    "id": "attempt-123",
    "startedAt": "2024-01-20T10:30:00Z"
  },
  "questions": [
    {
      "id": "q-001",
      "text": "What is the process of photosynthesis?",
      "imageUrl": null,
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "marks": 1,
      "index": 0
    }
  ]
}
```

---

### POST `/api/exams/[id]`
Submit exam answers (locks answers, calculates score).

**Request**
```json
{
  "attemptId": "attempt-123",
  "answers": [
    { "questionId": "q-001", "selectedOption": 0 },
    { "questionId": "q-002", "selectedOption": 2 },
    { "questionId": "q-003", "selectedOption": null }
  ]
}
```

**Response**
```json
{
  "result": {
    "id": "result-001",
    "examId": "exam-001",
    "studentUid": "uid-123",
    "score": 85.5,
    "totalMarks": 100,
    "correctCount": 85,
    "wrongCount": 15,
    "skippedCount": 0,
    "timeTakenSeconds": 1800,
    "submittedAt": "2024-01-20T11:30:00Z",
    "rank": 5,
    "totalParticipants": 150
  }
}
```

---

### GET `/api/exams/mine`
Get exams student can attempt (all exams, filtered by access).

**Response**
```json
{
  "exams": [
    {
      "id": "exam-001",
      "title": "Biology Practice Exam",
      "examMode": "practice",
      "courseType": "Academic",
      "attempts": 0,
      "canAttempt": true
    }
  ]
}
```

---

### GET `/api/exams/completed-public`
Get student's results on public exams.

**Response**
```json
{
  "results": [
    {
      "examId": "exam-001",
      "examTitle": "Biology Mock 1",
      "score": 85,
      "totalMarks": 100,
      "rank": 5,
      "submittedAt": "2024-01-20T11:30:00Z"
    }
  ]
}
```

---

### GET `/api/qa?subject=<subjectId>`
Get Q&A questions (filtered by subject, see Public API).

---

### POST `/api/qa`
Ask a question (requires paid enrollment).

**Request**
```json
{
  "categoryId": "cat-001",
  "courseId": "course-001",
  "subjectId": "subject-001",
  "text": "How does photosynthesis work in different light conditions?",
  "imageUrl": "https://..." (optional)
}
```

**Response**
```json
{
  "question": {
    "id": "q-001",
    "subjectId": "subject-001",
    "studentName": "Imran",
    "text": "How does photosynthesis work...",
    "status": "unanswered",
    "createdAt": "2024-01-20T14:30:00Z"
  }
}
```

**Error Responses**
```json
{ "error": "Sign in to ask a question." }
{ "error": "You can only ask about a course you are actively enrolled in." }
{ "error": "Asking questions is available only to students with paid enrollment." }
```

---

### GET `/api/notifications?count=1`
Get unread notification count.

**Response**
```json
{
  "unreadCount": 3
}
```

---

### POST `/api/push`
Register push notification token.

**Request**
```json
{
  "token": "firebase-push-token-xyz"
}
```

---

## Admin APIs (Auth + Role Required)

All admin APIs require:
1. Valid Firebase token in Authorization header
2. UID/email in `admins` table (is_active = 1)
3. Appropriate role + permission (if role-based)

### GET `/api/admin`
Check if user is admin, get role + permissions.

**Response**
```json
{
  "isAdmin": true,
  "admin": {
    "uid": "admin-uid-123",
    "email": "admin@medispark.com",
    "displayName": "Admin User"
  },
  "role": "admin",
  "permissions": ["manageContent", "editOwnProfile", ...]
}
```

**Response (Not Admin)**
```json
{
  "isAdmin": false
}
```

---

### GET `/api/admin/courses`
List all courses.

**Response**
```json
{
  "courses": [
    {
      "slug": "hsc-biology-001",
      "name": "HSC 2024 Biology",
      "category": "HSC Academic",
      "batchId": "hsc-28",
      "status": "published",
      "availability": "available",
      "fee": 5000,
      "discountFee": null,
      "createdAt": "2024-01-01T10:00:00Z"
    }
  ]
}
```

---

### POST `/api/admin/courses`
Create new course.

**Request**
```json
{
  "slug": "hsc-chemistry-2024",
  "name": "HSC 2024 Chemistry",
  "category": "HSC Academic",
  "batchId": "hsc-28",
  "image": "https://...",
  "fee": 6000,
  "teacherName": "Dr. Khan",
  "duration": "45 hours"
}
```

---

### PUT `/api/admin/courses/[slug]`
Update course.

**Request** (same as POST)

---

### DELETE `/api/admin/courses/[slug]`
Delete course.

---

### GET `/api/admin/exams`
List all exams.

**Query Parameters**
- `kind`: Filter by "public", "practice", or "enrolled"
- `status`: Filter by "draft", "published", or "closed"
- `search`: Search by title

**Response**
```json
{
  "exams": [
    {
      "id": "exam-001",
      "title": "Biology Mock 1",
      "kind": "public",
      "status": "published",
      "examMode": "practice",
      "totalMarks": 100,
      "durationMinutes": 60,
      "questionCount": 50,
      "createdAt": "2024-01-01T10:00:00Z"
    }
  ]
}
```

---

### POST `/api/admin/exams`
Create new exam.

**Request**
```json
{
  "title": "Biology Diagnostic Exam",
  "kind": "public",
  "subject": "Biology",
  "batchId": "hsc-28",
  "courseType": "Academic",
  "totalMarks": 100,
  "durationMinutes": 60,
  "negativeEnabled": true,
  "negativePerWrong": 0.25
}
```

---

### PUT `/api/admin/exams/[id]`
Update exam.

**Request** (same fields as POST, plus):
```json
{
  "status": "published",
  "startsAt": "2024-02-01T10:00:00Z",
  "endsAt": "2024-02-01T11:00:00Z"
}
```

---

### DELETE `/api/admin/exams/[id]`
Delete exam.

---

### POST `/api/admin/exams/[id]/questions`
Add questions to exam or bank.

**Request**
```json
{
  "questions": [
    {
      "text": "What is photosynthesis?",
      "options": ["A", "B", "C", "D"],
      "correctOption": 0,
      "marks": 1,
      "bankOnly": false
    }
  ]
}
```

---

### GET `/api/admin/students`
List all students.

**Query Parameters**
- `search`: Search by name, email, or student ID
- `page`: Pagination (0-based)
- `limit`: Items per page (default 20)

**Response**
```json
{
  "students": [
    {
      "uid": "uid-123",
      "studentId": "MS-A1B2C3D4",
      "fullName": "Imran Ahmed",
      "email": "imran@example.com",
      "institution": "Dhaka College",
      "enrollmentCount": 5,
      "createdAt": "2024-01-01T10:00:00Z"
    }
  ],
  "total": 1234
}
```

---

### PUT `/api/admin/students/[uid]`
Update student profile.

**Request**
```json
{
  "fullName": "Imran Ahmed",
  "institution": "Dhaka College",
  "hscBatch": "2024"
}
```

---

### GET `/api/admin/enrollments`
List pending enrollment applications (paid courses).

**Response**
```json
{
  "applications": [
    {
      "id": "app-001",
      "studentId": "MS-A1B2C3D4",
      "studentEmail": "imran@example.com",
      "courseId": "course-001",
      "courseName": "HSC Chemistry",
      "transactionId": "TXN-123456789",
      "paidAmount": 4500,
      "senderMobile": "01712345678",
      "paymentMethod": "bkash",
      "status": "pending_validation",
      "createdAt": "2024-01-20T10:30:00Z"
    }
  ]
}
```

---

### PUT `/api/admin/enrollments/[appId]`
Approve or reject enrollment application.

**Request**
```json
{
  "action": "approve",
  "note": "Payment verified"
}
```

---

### GET `/api/admin/qa`
List Q&A questions for moderation.

**Query Parameters**
- `status`: "answered" or "unanswered"
- `page`: Pagination

**Response**
```json
{
  "questions": [
    {
      "id": "q-001",
      "studentName": "Imran",
      "text": "How does photosynthesis work?",
      "status": "unanswered",
      "createdAt": "2024-01-20T14:30:00Z"
    }
  ]
}
```

---

### POST `/api/admin/qa/[questionId]/answer`
Add teacher answer to question.

**Request**
```json
{
  "content": "Photosynthesis is the process by which plants..."
}
```

---

### DELETE `/api/admin/qa/[questionId]`
Delete question.

---

### POST `/api/admin/media`
Upload media file (logo, banner, course image, etc.).

**Request**
```
FormData:
- file: <File>
- directory: "course-images" | "website" | "banners" | etc.
```

**Response**
```json
{
  "url": "https://medispark.duckdns.org/medifiles/course-images/uuid.png"
}
```

---

### DELETE `/api/admin/media`
Delete media file.

**Request**
```json
{
  "url": "https://medispark.duckdns.org/medifiles/course-images/uuid.png"
}
```

---

### GET `/api/admin/coupons`
List all coupons.

**Response**
```json
{
  "coupons": [
    {
      "id": "coup-001",
      "code": "SUMMER2024",
      "discountType": "percent",
      "discountValue": 10,
      "usageLimit": 100,
      "usedCount": 25,
      "validFrom": "2024-06-01T00:00:00Z",
      "validUntil": "2024-08-31T23:59:59Z",
      "isActive": true
    }
  ]
}
```

---

### POST `/api/admin/coupons`
Create coupon.

**Request**
```json
{
  "code": "NEWYEAR2025",
  "discountType": "percent",
  "discountValue": 15,
  "usageLimit": 500,
  "validFrom": "2025-01-01T00:00:00Z",
  "validUntil": "2025-01-31T23:59:59Z"
}
```

---

### PUT `/api/admin/coupons/[id]`
Update coupon.

---

### DELETE `/api/admin/coupons/[id]`
Delete coupon.

---

### GET `/api/admin/roles`
List admin roles + permissions.

**Response**
```json
{
  "roles": [
    {
      "name": "admin",
      "permissions": ["*"] // Super admin
    },
    {
      "name": "content-manager",
      "permissions": ["manageContent", "editOwnProfile"]
    }
  ]
}
```

---

### POST `/api/admin/roles`
Create new role.

**Request**
```json
{
  "name": "exam-admin",
  "permissions": ["manageExams", "viewResults"]
}
```

---

### PUT `/api/admin/roles/[email]`
Assign role to admin email.

**Request**
```json
{
  "role": "exam-admin"
}
```

---

### GET `/api/admin/profile`
Get current admin's profile.

**Response**
```json
{
  "admin": {
    "uid": "uid-123",
    "email": "admin@medispark.com",
    "displayName": "Admin Name",
    "photoUrl": "https://...",
    "role": "admin"
  }
}
```

---

### PATCH `/api/admin/profile`
Update admin profile + avatar.

**Request**
```
FormData:
- displayName: "Admin Name"
- photoUrl: <File> (optional)
```

---

### POST `/api/admin/notifications`
Send push notification to students.

**Request**
```json
{
  "title": "New Course Available!",
  "body": "Check out our latest HSC Biology course.",
  "targetSegment": "all" | "paid-students" | "free-students",
  "courseId": "course-id" (optional)
}
```

---

### GET `/api/admin/system`
Get system information + database status.

**Response**
```json
{
  "database": {
    "connected": true,
    "host": "20.219.193.182"
  },
  "firebase": {
    "configured": true,
    "projectId": "medisparkgo"
  },
  "media": {
    "configured": true,
    "baseUrl": "https://medispark.duckdns.org/medifiles"
  }
}
```

---

## Website Configuration APIs

### GET `/api/website-settings`
Get site-wide branding (title, meta, favicon).

**Response**
```json
{
  "siteTitle": "MediSpark",
  "metaDescription": "HSC & Medical Admission Prep",
  "faviconUrl": "https://...",
  "contactEmail": "support@medispark.com",
  "contactPhone": "+880...",
  "ogImageUrl": "https://..."
}
```

---

### PUT `/api/website-settings`
Update website settings (admin only).

---

### GET `/api/theme-settings`
Get theme configuration.

**Response**
```json
{
  "themeMode": "dark",
  "primaryColor": "#3b82f6",
  "accentColor": "#ef4444",
  "buttonStyle": "rounded",
  "borderRadius": "medium"
}
```

---

### PUT `/api/theme-settings`
Update theme (admin only).

---

### GET `/api/hero`
Get hero section configuration.

**Response**
```json
{
  "title": "Master Your HSC Prep",
  "subtitle": "Complete courses, exams, and Q&A",
  "ctaText": "Get Started",
  "ctaUrl": "/courses",
  "backgroundImageUrl": "https://...",
  "isActive": true
}
```

---

### PUT `/api/hero`
Update hero section (admin only).

---

### GET `/api/navbar-settings`
Get navbar menu items.

**Response**
```json
{
  "menuItems": [
    { "label": "Courses", "href": "/courses" },
    { "label": "Exams", "href": "/exam" },
    { "label": "Q&A", "href": "/qa" }
  ],
  "showSearch": true,
  "logoPosition": "left"
}
```

---

### PUT `/api/navbar-settings`
Update navbar (admin only).

---

### GET `/api/logo`
Get active logo + theme variants.

**Response**
```json
{
  "activeLogo": {
    "url": "https://...",
    "darkModeUrl": "https://...",
    "uploadedAt": "2024-01-01T10:00:00Z"
  }
}
```

---

### POST `/api/logo`
Upload logo (admin only).

**Request**
```
FormData:
- file: <File>
- variant: "light" | "dark" (optional)
```

---

### GET `/api/seo-settings`
Get SEO metadata.

**Response**
```json
{
  "siteTitle": "MediSpark",
  "metaDescription": "...",
  "keywords": "HSC, medical, admission",
  "ogTitle": "MediSpark Platform",
  "ogDescription": "...",
  "ogImageUrl": "https://..."
}
```

---

### PUT `/api/seo-settings`
Update SEO (admin only).

---

### GET `/api/homepage-sections`
Get homepage section visibility + order.

**Response**
```json
{
  "sections": [
    { "key": "banner", "isActive": true, "order": 1 },
    { "key": "hero", "isActive": true, "order": 2 },
    { "key": "featured-courses", "isActive": true, "order": 3 },
    { "key": "reviews", "isActive": true, "order": 6 }
  ]
}
```

---

### PUT `/api/homepage-sections`
Update section visibility (admin only).

---

### GET `/api/featured-slides`
Get banner carousel slides.

**Response**
```json
{
  "slides": [
    {
      "id": "slide-001",
      "imageUrl": "https://...",
      "title": "Summer Sale",
      "order": 1,
      "isActive": true
    }
  ]
}
```

---

### POST `/api/featured-slides`
Add banner slide (admin only).

---

### GET `/api/featured-courses`
Get featured courses list.

**Response**
```json
{
  "courses": [
    {
      "courseId": "course-001",
      "courseName": "HSC Biology",
      "order": 1,
      "isActive": true
    }
  ]
}
```

---

### POST `/api/featured-courses`
Add featured course (admin only).

---

### GET `/api/dashboard-cards`
Get student dashboard card configuration.

**Response**
```json
{
  "cards": [
    { "type": "enrollments", "title": "My Courses", "isActive": true },
    { "type": "exams", "title": "My Exams", "isActive": true }
  ]
}
```

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP Status Codes:
- **200 OK** - Success
- **201 Created** - Resource created
- **400 Bad Request** - Invalid input
- **401 Unauthorized** - Missing/invalid token
- **403 Forbidden** - Not authorized for this resource
- **404 Not Found** - Resource doesn't exist
- **409 Conflict** - Duplicate/conflicting state
- **500 Internal Server Error** - Server error

---

## Rate Limiting

Currently no API rate limiting is implemented. Consider adding:
- Per-IP limits
- Per-user limits (auth required)
- Endpoint-specific limits (e.g., file uploads)

---

## Authentication Flow Diagram

```
1. User clicks "Continue with Google"
2. Firebase GoogleAuthProvider.signInWithPopup()
   ↓
3. Google OAuth flow
   ↓
4. Firebase returns User + idToken
   ↓
5. Client stores token in localStorage (persistent)
   ↓
6. Client calls API with: Authorization: Bearer <idToken>
   ↓
7. Server calls: getFirebaseUser(request)
   ├─ Extracts Bearer token from header
   ├─ Calls Firebase Admin SDK verifyIdToken()
   └─ Returns DecodedIdToken or null
   ↓
8. If valid, proceed; otherwise return 401
```

---

## Pagination

Some list endpoints support pagination:

**Query Parameters**
- `page`: 0-based page number
- `limit`: Items per page (default: 20)

**Response**
```json
{
  "data": [...],
  "page": 0,
  "limit": 20,
  "total": 1234,
  "hasMore": true
}
```

---

## Caching

- **Query Cache (mysql.ts)**: 5-second TTL for SELECT queries
- **Next.js Cache (unstable_cache)**: 60s for layouts + homepage data
- **Browser Cache**: Images (immutable), static assets (1 year)

---

## Implementation Notes

### Bearer Token in Requests
```javascript
const token = await user.getIdToken();
const response = await fetch('/api/endpoint', {
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

### File Uploads
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('directory', 'course-images');

const response = await fetch('/api/admin/media', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData
});
```

### Coupon Validation (Server-Side)
- **Never trust** client-side discount calculations
- Always revalidate coupon on `/api/enrollments` POST
- Recalculate discounted fee server-side
- Check usage limits before applying
