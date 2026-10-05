import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as helpers from "../src/lib/enrolled-exams.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: (string | number | null)[]): Record<string, unknown>[];
      run(...params: (string | number | null)[]): unknown;
    };
    close(): void;
  };
};

function loadModule<T>(path: string, imports: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    console: { error: () => undefined },
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency (no full enrollment/progress loader allowed): ${name}`);
      return imports[name];
    },
  }, { filename: path });
  return loaded.exports as T;
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  // The relevant actual schema has status/availability and hard deletion,
  // not is_published, deleted_at or is_deleted columns.
  db.exec(`
    CREATE TABLE catalog_courses (
      slug TEXT PRIMARY KEY, name TEXT NOT NULL, image_url TEXT,
      content_layout TEXT, status TEXT DEFAULT 'published',
      availability TEXT DEFAULT 'available'
    );
    CREATE TABLE enrollments (
      student_uid TEXT, course_id TEXT, course_name TEXT DEFAULT 'Snapshot name',
      course_kind TEXT DEFAULT 'free', enrollment_status TEXT DEFAULT 'active',
      updated_at TEXT DEFAULT '2026-10-05 12:00:00',
      PRIMARY KEY (student_uid, course_id)
    );
  `);
  let queryCount = 0;
  let failDb = false;
  let authUid: string | null = "student-a";
  let configured = true;
  const query = async (sql: string, params: unknown[] = [], options?: { cache?: number | false }) => {
    queryCount += 1;
    assert.equal(options?.cache, false, "Every shortcut read must bypass the MySQL SELECT cache");
    assert.equal(params.length, 1, "The only query input must be the authenticated UID");
    if (failDb) throw new Error("Database unavailable (fixture)");
    return db.prepare(sql).all(...params as (string | number | null)[]);
  };
  const server = loadModule<typeof import("../src/lib/enrolled-exams-server.ts")>(
    "src/lib/enrolled-exams-server.ts",
    { "@/lib/mysql": { query }, "@/lib/enrolled-exams": helpers },
  );
  const route = loadModule<typeof import("../src/app/api/my/enrolled-exams/route.ts")>(
    "src/app/api/my/enrolled-exams/route.ts",
    {
      "next/server": require("next/server"),
      "@/lib/auth-api": { getFirebaseUser: async () => authUid ? { uid: authUid } : null },
      "@/lib/mysql": { get isMysqlConfigured() { return configured; } },
      "@/lib/enrolled-exams-server": server,
    },
  );
  const addCourse = (slug: string, layout: string | null = "flow-1") => {
    db.prepare("INSERT INTO catalog_courses (slug, name, image_url, content_layout) VALUES (?, ?, ?, ?)")
      .run(slug, `Live ${slug}`, `/banners/${slug}.png`, layout);
  };
  const enroll = (course: string, uid = "student-a", status = "active", kind = "free") => {
    db.prepare("INSERT INTO enrollments (student_uid, course_id, enrollment_status, course_kind) VALUES (?, ?, ?, ?)")
      .run(uid, course, status, kind);
  };
  const { NextRequest } = require("next/server");
  const get = () => route.GET(new NextRequest("http://localhost/api/my/enrolled-exams?uid=student-b&student_uid=student-b"));
  return {
    db, server, route, addCourse, enroll, get,
    get queryCount() { return queryCount; },
    fail: () => { failDb = true; },
    authenticate: (uid: string | null) => { authUid = uid; },
    configure: (value: boolean) => { configured = value; },
  };
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("enrolled exam shortcut routing", () => {
  it("resolves raw flow-4 independently of flow-5, with all legacy layouts using the unified course-exams section", () => {
    for (const layout of ["flow-1", "flow-2", "flow-3", "auto", "direct", "paper", "subject", "", "unknown", null, undefined]) {
      assert.equal(helpers.resolveDirectExamRoute("my-course", layout), "/dashboard/enrolled-courses/my-course/course-exams");
    }
    assert.equal(helpers.resolveDirectExamRoute("my-course", "flow-4"), "/dashboard/enrolled-courses/my-course/flow4-exams");
    assert.equal(helpers.resolveDirectExamRoute("my-course", "flow-5"), "/dashboard/enrolled-courses/my-course/exam-flow");
    assert.equal(helpers.resolveDirectExamRoute("my-course", " FLOW-4 "), "/dashboard/enrolled-courses/my-course/flow4-exams");
  });

  it("encodes the entire course slug as one path segment", () => {
    for (const layout of ["flow-1", "flow-4", "flow-5"]) {
      const route = helpers.resolveDirectExamRoute("HSC বাংলা / 100%?#", layout);
      assert.ok(route.startsWith(`/dashboard/enrolled-courses/${encodeURIComponent("HSC বাংলা / 100%?#")}/`));
      assert.ok(!route.includes("?"));
      assert.ok(!route.includes("#"));
    }
  });

  it("returns only exams/quizzes in subject order without mutating direct content", () => {
    const content = (id: string, type: string): helpers.Flow4ExamContent => ({
      id, title: id, contentType: type, videoUrl: null, fileUrl: null, durationMinutes: 10,
    });
    const subjects = [
      { id: "empty", name: "Empty", contents: [] },
      { id: "class-only", name: "Classes", contents: [content("video", "class"), content("note", "pdf")] },
      { id: "biology", name: "Biology", contents: [content("class", "video"), content("quiz", "quiz"), content("exam", "exam")] },
      { id: "chemistry", name: "Chemistry", contents: [content("exam2", " EXAM ")] },
    ];
    const result = helpers.selectFlow4ExamSubjects(subjects);
    assert.deepEqual(result.map((subject) => subject.id), ["biology", "chemistry"]);
    assert.deepEqual(result[0].contents.map((item) => item.id), ["quiz", "exam"]);
    assert.equal(subjects[2].contents.length, 3);
  });

  it("preserves Flow4Student exam link priority: video, file, then encoded /exam/id/rules", () => {
    const content: helpers.Flow4ExamContent = {
      id: "sc-exam / বাংলা", title: "Exam", contentType: "exam", durationMinutes: 10,
      videoUrl: "https://example.com/video", fileUrl: "https://example.com/exam.pdf",
    };
    assert.deepEqual(helpers.getFlow4ExamLink(content), { href: content.videoUrl, label: "Watch", external: true });
    assert.deepEqual(helpers.getFlow4ExamLink({ ...content, videoUrl: null }), { href: content.fileUrl, label: "Open", external: true });
    assert.deepEqual(helpers.getFlow4ExamLink({ ...content, videoUrl: null, fileUrl: null }), {
      href: `/exam/${encodeURIComponent(content.id)}/rules`, label: "Start", external: false,
    });
  });
});

describe("fresh authenticated enrolled-exams API", () => {
  it("returns the exact empty payload without querying progress or content tables", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    const response = await f.get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { enrolled_courses: [] });
    assert.equal(f.queryCount, 1);
    assert.equal(f.route.dynamic, "force-dynamic");
  });

  it("uses the verified Firebase UID only; never another UID supplied by the caller", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    f.addCourse("own", "flow-4");
    f.addCourse("other", "flow-5");
    f.enroll("own");
    f.enroll("other", "student-b");
    const response = await f.get();
    assert.deepEqual(await response.json(), {
      enrolled_courses: [{
        course_id: "own", course_name: "Live own", banner_image_url: "/banners/own.png",
        direct_exam_route_url: "/dashboard/enrolled-courses/own/flow4-exams",
      }],
    });
    f.authenticate("student-b");
    assert.deepEqual(plain(await f.server.getMyEnrolledExams("student-b")).map((item: helpers.EnrolledExamCourse) => item.course_id), ["other"]);
  });

  it("includes active free/paid/hidden courses but excludes non-active enrollments and unpublished/deleted courses", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    for (const [slug, status] of [["free", "active"], ["paid", "active"], ["pending", "pending"], ["cancelled", "cancelled"], ["rejected", "rejected"], ["inactive", "inactive"]]) {
      f.addCourse(slug);
      f.enroll(slug, "student-a", status, slug === "paid" ? "paid" : "free");
    }
    for (const slug of ["unpublished", "hidden", "deleted"]) {
      f.addCourse(slug);
      f.enroll(slug);
    }
    f.db.exec("UPDATE catalog_courses SET status = 'unpublished' WHERE slug = 'unpublished'");
    f.db.exec("UPDATE catalog_courses SET availability = 'hidden' WHERE slug = 'hidden'");
    f.db.exec("DELETE FROM catalog_courses WHERE slug = 'deleted'");
    const result = await f.server.getMyEnrolledExams("student-a");
    assert.deepEqual(plain(result).map((item: helpers.EnrolledExamCourse) => item.course_id).sort(), ["free", "hidden", "paid"]);
    assert.equal(f.queryCount, 1);
  });

  it("matches the existing enrollment gate for hidden published courses, without granting other students access", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    f.addCourse("hidden-course", "flow-4");
    f.enroll("hidden-course");
    f.db.exec("UPDATE catalog_courses SET availability = 'hidden'");
    const learning = loadModule<typeof import("../src/lib/my-learning.ts")>(
      "src/lib/my-learning.ts",
      {
        "@/lib/mysql": {
          query: async (sql: string, params: (string | number | null)[]) => f.db.prepare(sql).all(...params),
        },
        "@/lib/course-content": {},
        "@/lib/courses-admin": {},
      },
    );
    assert.equal(await learning.hasActiveEnrollment("student-a", "hidden-course"), true);
    assert.equal((await f.server.getMyEnrolledExams("student-a"))[0].course_id, "hidden-course");
    assert.equal(await learning.hasActiveEnrollment("student-b", "hidden-course"), false);
    assert.deepEqual(plain(await f.server.getMyEnrolledExams("student-b")), []);
    f.db.exec("UPDATE enrollments SET enrollment_status = 'pending'");
    assert.equal(await learning.hasActiveEnrollment("student-a", "hidden-course"), false);
    assert.deepEqual(plain(await f.server.getMyEnrolledExams("student-a")), []);
  });

  it("returns only live catalog name/banner and resolves every layout without a snapshot fallback", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    const layouts = ["flow-1", "flow-2", "flow-3", "flow-4", "flow-5", "auto", null];
    for (const [index, layout] of layouts.entries()) {
      const slug = `course ${index} বাংলা`;
      f.addCourse(slug, layout);
      f.enroll(slug);
    }
    f.db.exec("UPDATE catalog_courses SET image_url = NULL WHERE content_layout IS NULL");
    const response = await f.get();
    const { enrolled_courses } = await response.json() as { enrolled_courses: helpers.EnrolledExamCourse[] };
    assert.equal(enrolled_courses.length, layouts.length);
    for (const [index, course] of enrolled_courses.entries()) {
      assert.deepEqual(Object.keys(course).sort(), ["banner_image_url", "course_id", "course_name", "direct_exam_route_url"]);
      assert.equal(course.course_name, `Live ${course.course_id}`);
      assert.equal(course.direct_exam_route_url, helpers.resolveDirectExamRoute(course.course_id, layouts[index]));
    }
    assert.equal(enrolled_courses.at(-1)?.banner_image_url, "");
  });

  it("immediately reflects admin name/banner/layout, enrollment, publish, hide and deletion changes", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    f.addCourse("mutable", "flow-4");
    f.enroll("mutable");
    const courses = async () => (await (await f.get()).json()).enrolled_courses as helpers.EnrolledExamCourse[];
    assert.equal((await courses())[0].direct_exam_route_url, "/dashboard/enrolled-courses/mutable/flow4-exams");
    f.db.exec("UPDATE catalog_courses SET name = 'Renamed', image_url = '/fresh.png', content_layout = 'flow-5' WHERE slug = 'mutable'");
    assert.deepEqual(await courses(), [{
      course_id: "mutable", course_name: "Renamed", banner_image_url: "/fresh.png",
      direct_exam_route_url: "/dashboard/enrolled-courses/mutable/exam-flow",
    }]);
    f.db.exec("UPDATE catalog_courses SET content_layout = 'flow-2' WHERE slug = 'mutable'");
    assert.equal((await courses())[0].direct_exam_route_url, "/dashboard/enrolled-courses/mutable/course-exams");
    f.db.exec("UPDATE enrollments SET enrollment_status = 'pending'");
    assert.deepEqual(await courses(), []);
    f.db.exec("UPDATE enrollments SET enrollment_status = 'active'");
    assert.equal((await courses()).length, 1);
    f.db.exec("UPDATE catalog_courses SET status = 'unpublished'");
    assert.deepEqual(await courses(), []);
    f.db.exec("UPDATE catalog_courses SET status = 'published', availability = 'hidden'");
    assert.equal((await courses()).length, 1, "Hiding a course must not revoke existing active enrollment access");
    f.db.exec("UPDATE catalog_courses SET availability = 'available'");
    assert.equal((await courses()).length, 1);
    f.db.exec("DELETE FROM catalog_courses");
    assert.deepEqual(await courses(), []);
    assert.equal(f.queryCount, 9, "One uncached SQL query per GET, even after mutations");
  });

  it("denies missing/invalid auth and an unconfigured database without querying", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    f.authenticate(null);
    let response = await f.get();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    f.authenticate("student-a");
    f.configure(false);
    response = await f.get();
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(f.queryCount, 0);
  });

  it("returns an uncached failure, never a misleading successful empty list", async (t) => {
    const f = fixture();
    t.after(() => f.db.close());
    f.fail();
    await assert.rejects(f.server.getMyEnrolledExams("student-a"), /Database unavailable/);
    const response = await f.get();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Could not load your enrolled exams." });
  });
});

// Run: node --experimental-strip-types --test tests/enrolled-exams.test.ts
// SQLite executes the production SELECT without needing MySQL credentials (Node 22.13+).
