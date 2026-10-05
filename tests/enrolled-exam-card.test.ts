import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as settings from "../src/lib/enrolled-exam-card.ts";

const require = createRequire(import.meta.url);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function loadModule<T>(path: string, imports: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    console: { error: () => undefined },
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
  });
  return loaded.exports as T;
}

function fixture() {
  let stored: unknown = undefined;
  let missingTable = false;
  let failed = false;
  let corrupt = false;
  let gate: "ok" | "forbidden" | "unauthenticated" = "ok";
  const writes: { sql: string; params: unknown[] }[] = [];
  const logs: string[] = [];
  const mysql = {
    query: async (_sql: string, params: unknown[], options: { cache?: number | false }) => {
      assert.equal(options.cache, false);
      assert.deepEqual(plain(params), [settings.ENROLLED_EXAM_CARD_KEY]);
      if (failed) throw new Error("DB unavailable");
      if (missingTable) throw Object.assign(new Error("Missing table"), { code: "ER_NO_SUCH_TABLE" });
      if (corrupt) return [{ setting_value: "not-json" }];
      return stored === undefined ? [] : [{ setting_value: stored }];
    },
    exec: async (sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      if (failed) throw new Error("DB unavailable");
      if (sql.startsWith("CREATE TABLE")) missingTable = false;
      else if (sql.startsWith("INSERT")) {
        assert.equal(params[0], settings.ENROLLED_EXAM_CARD_KEY);
        assert.equal(params[2], "admin-owner");
        stored = String(params[1]);
      } else if (sql.startsWith("DELETE")) stored = undefined;
      return { affectedRows: 1 };
    },
  };
  const server = loadModule<typeof import("../src/lib/enrolled-exam-card-server.ts")>(
    "src/lib/enrolled-exam-card-server.ts", { "@/lib/mysql": mysql, "@/lib/enrolled-exam-card": settings },
  );
  const common = {
    "next/server": require("next/server"),
    "@/lib/enrolled-exam-card-server": server,
  };
  const admin = loadModule<typeof import("../src/app/api/admin/exams/enrolled-card/route.ts")>(
    "src/app/api/admin/exams/enrolled-card/route.ts", {
      ...common,
      "@/lib/enrolled-exam-card": settings,
      "@/lib/admin": {
        requireAnyPermissionResult: async (_request: unknown, permissions: string[]) => {
          assert.deepEqual(plain(permissions), ["manageExams", "managePublicExam"]);
          return { status: gate, user: gate === "ok" ? { uid: "admin-owner" } : null };
        },
      },
      "@/lib/administration": { logAdminAction: async (_user: unknown, action: string) => { logs.push(action); } },
    },
  );
  const publicRoute = loadModule<typeof import("../src/app/api/public-exams/enrolled-card/route.ts")>(
    "src/app/api/public-exams/enrolled-card/route.ts", common,
  );
  const { NextRequest } = require("next/server");
  const request = (method = "GET", body?: unknown) => new NextRequest("http://localhost/api/admin/exams/enrolled-card", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
  return {
    server, admin, publicRoute, request, writes, logs,
    gate: (value: typeof gate) => { gate = value; },
    store: (value: unknown) => { stored = value; },
    fail: (value = true) => { failed = value; },
    missing: () => { missingTable = true; },
    corrupt: () => { corrupt = true; },
  };
}

async function responseData(response: Response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return response.json();
}

describe("enrolled card input validation", () => {
  it("accepts every configured icon and normalizes user-facing text", () => {
    for (const icon of settings.ENROLLED_EXAM_CARD_ICONS) {
      assert.deepEqual(settings.validateEnrolledExamCard({ ...settings.DEFAULT_ENROLLED_EXAM_CARD, title: "  আমার পরীক্ষা  ", subtitle: "  English & বাংলা  ", icon: icon.value }), {
        is_active: true, title: "আমার পরীক্ষা", subtitle: "English & বাংলা", icon: icon.value,
      });
    }
  });
  it("rejects coercible visibility values, blank titles, excessive text and unsafe icons", () => {
    for (const patch of [
      { is_active: "false" }, { is_active: 1 }, { is_active: null },
      { title: " " }, { title: 20 }, { title: "x".repeat(121) },
      { subtitle: null }, { subtitle: "x".repeat(501) },
      { icon: "<svg onload=alert(1)>" }, { icon: "unknown" },
    ]) assert.throws(() => settings.validateEnrolledExamCard({ ...settings.DEFAULT_ENROLLED_EXAM_CARD, ...patch }));
    for (const value of [null, [], "invalid", {}]) assert.throws(() => settings.validateEnrolledExamCard(value));
  });
  it("permits an empty subtitle and does not copy arbitrary fields into public settings", () => {
    const result = settings.validateEnrolledExamCard({ ...settings.DEFAULT_ENROLLED_EXAM_CARD, subtitle: "", updated_by: "forged" });
    assert.equal(result.subtitle, "");
    assert.equal(Object.hasOwn(result, "updated_by"), false);
  });
});

describe("global enrolled-card persistence", () => {
  it("returns independent defaults only when no row exists, without DDL on normal reads", async () => {
    const f = fixture();
    const first = await f.server.fetchEnrolledExamCard();
    first.is_active = false;
    assert.deepEqual(plain(await f.server.fetchEnrolledExamCard()), settings.DEFAULT_ENROLLED_EXAM_CARD);
    assert.equal(f.writes.length, 0);
  });
  it("supports MySQL JSON objects and MariaDB JSON strings", async () => {
    const f = fixture();
    const disabled = { ...settings.DEFAULT_ENROLLED_EXAM_CARD, is_active: false };
    for (const stored of [disabled, JSON.stringify(disabled)]) {
      f.store(stored);
      assert.deepEqual(plain(await f.server.fetchEnrolledExamCard()), disabled);
    }
  });
  it("creates the table lazily only for an actual missing-table error", async () => {
    const f = fixture(); f.missing();
    assert.deepEqual(plain(await f.server.fetchEnrolledExamCard()), settings.DEFAULT_ENROLLED_EXAM_CARD);
    assert.equal(f.writes.length, 1);
    assert.ok(f.writes[0].sql.startsWith("CREATE TABLE IF NOT EXISTS global_settings"));
  });
  it("persists disabled/custom content without stale reads, and resets only this singleton", async () => {
    const f = fixture();
    const custom = { is_active: false, title: "My Paid Exams", subtitle: "New subtitle", icon: "calendar" };
    assert.deepEqual(plain(await f.server.saveEnrolledExamCard(custom, "admin-owner")), custom);
    assert.deepEqual(plain(await f.server.fetchEnrolledExamCard()), custom);
    await f.server.resetEnrolledExamCard();
    assert.deepEqual(plain(await f.server.fetchEnrolledExamCard()), settings.DEFAULT_ENROLLED_EXAM_CARD);
    assert.ok(f.writes[1].sql.includes("WHERE setting_key = ?"));
    assert.deepEqual(plain(f.writes[1].params), [settings.ENROLLED_EXAM_CARD_KEY]);
  });
  it("never silently re-enables the card after database failures or corrupt data", async () => {
    const f = fixture(); f.fail();
    await assert.rejects(f.server.fetchEnrolledExamCard());
    assert.equal(f.writes.length, 0);
    f.fail(false); f.corrupt();
    await assert.rejects(f.server.fetchEnrolledExamCard());
  });
});

describe("enrolled-card admin and public APIs", () => {
  it("rejects anonymous and non-permitted admins for every admin method before persistence", async () => {
    const f = fixture();
    for (const [gate, status] of [["unauthenticated", 401], ["forbidden", 403]] as const) {
      f.gate(gate);
      await responseData(await f.admin.GET(f.request()), status);
      await responseData(await f.admin.PUT(f.request("PUT", settings.DEFAULT_ENROLLED_EXAM_CARD)), status);
      await responseData(await f.admin.DELETE(f.request("DELETE")), status);
    }
    assert.equal(f.writes.length, 0);
    assert.equal(f.logs.length, 0);
  });
  it("creates/reads/updates/deletes settings with permission checks, audit logs and no-store", async () => {
    const f = fixture();
    const custom = { ...settings.DEFAULT_ENROLLED_EXAM_CARD, is_active: false, title: "Paid Course Exams", icon: "book-open" };
    assert.deepEqual(await responseData(await f.admin.PUT(f.request("PUT", custom))), { settings: custom });
    assert.deepEqual(await responseData(await f.admin.GET(f.request())), { settings: custom });
    assert.deepEqual(await responseData(await f.publicRoute.GET()), { settings: custom });
    assert.deepEqual(await responseData(await f.admin.DELETE(f.request("DELETE"))), { settings: settings.DEFAULT_ENROLLED_EXAM_CARD });
    assert.deepEqual(f.logs, ["settings.save", "settings.reset"]);
    assert.deepEqual(await responseData(await f.publicRoute.GET()), { settings: settings.DEFAULT_ENROLLED_EXAM_CARD });
  });
  it("returns 400 without writing malformed settings and 503/500 on database failures", async () => {
    const f = fixture();
    await responseData(await f.admin.PUT(f.request("PUT", { is_active: "false" })), 400);
    await responseData(await f.admin.PUT(f.request("PUT")), 400);
    assert.equal(f.writes.length, 0);
    f.fail();
    await responseData(await f.admin.GET(f.request()), 503);
    await responseData(await f.publicRoute.GET(), 503);
    await responseData(await f.admin.PUT(f.request("PUT", settings.DEFAULT_ENROLLED_EXAM_CARD)), 500);
    await responseData(await f.admin.DELETE(f.request("DELETE")), 500);
    assert.equal(f.logs.length, 0);
  });
  it("migration seeds a JSON boolean and never overwrites existing admin settings", () => {
    const migration = readFileSync(new URL("../src/sql/enrolled-exam-card-migration.sql", import.meta.url), "utf8");
    assert.match(migration, /INSERT IGNORE INTO global_settings/);
    assert.match(migration, /'is_active', JSON_EXTRACT\('true', '\$'\)/);
    assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|ON DUPLICATE KEY UPDATE/);
  });
});
