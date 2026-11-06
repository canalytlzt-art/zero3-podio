import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Request, Response } from "express";
import {
  classifyD1Failure,
  requireD1Member,
  respondD1Failure,
  type D1FailureKind,
} from "./d1-staging-shared";
import {
  D1PodiumDraftVersionConflict,
  saveD1PodiumDraft,
} from "./d1-staging-podium-draft";

function makeD1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bindings: unknown[]) {
          values = bindings;
          return statement;
        },
        async first<T>() {
          return (db.prepare(sql).get(...values as (string | number | null)[]) as T | undefined) ?? null;
        },
        async run() {
          const result = db.prepare(sql).run(...values as (string | number | null)[]);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function database({ arbitrationNote = true }: { arbitrationNote?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE zero3_podium_versions (
    event_id TEXT NOT NULL,
    category TEXT NOT NULL,
    registration_ids TEXT NOT NULL CHECK(json_valid(registration_ids)),
    ${arbitrationNote ? "arbitration_note TEXT," : ""}
    published INTEGER NOT NULL DEFAULT 0,
    published_by TEXT,
    published_at TEXT,
    publish_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(event_id,category,version)
  )`);
  return db;
}

const save = (
  DB: D1Database,
  registrationIds: Array<string | null>,
  updatedAt: string,
  arbitrationNote: string | null = null,
) => saveD1PodiumDraft(DB, {
  eventId: "event-demo",
  category: "RX",
  registrationIds,
  arbitrationNote,
  updatedAt,
});

function mockResponse() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(value: unknown) { body = value; return response; },
  } as unknown as Response;
  return { response, result: () => ({ statusCode, body }) };
}

test("new podium draft and edits save as private versions without touching publication", async () => {
  const db = database();
  const DB = makeD1(db);
  const initial = await save(DB, ["reg-a", "reg-b", "reg-c"], "2026-11-06T12:00:00.000Z");
  assert.equal(initial.version, 1);
  assert.equal(initial.published, 0);

  const edited = await save(DB, ["reg-a", "reg-c", "reg-b"], "2026-11-06T12:01:00.000Z", "Revisão manual");
  assert.equal(edited.version, 1);
  assert.deepEqual(JSON.parse(edited.registration_ids), ["reg-a", "reg-c", "reg-b"]);
  assert.equal(edited.arbitration_note, "Revisão manual");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions").get()?.count, 1);
  db.close();
});

test("concurrent first saves cannot create duplicate category versions", async () => {
  const db = database();
  const DB = makeD1(db);
  const attempts = await Promise.allSettled([
    save(DB, ["reg-a", "reg-b", "reg-c"], "2026-11-06T12:00:00.000Z"),
    save(DB, ["reg-c", "reg-b", "reg-a"], "2026-11-06T12:00:00.001Z"),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = attempts.find((item) => item.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof D1PodiumDraftVersionConflict);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions").get()?.count, 1);
  db.close();
});

test("concurrent edits use compare-and-swap and preserve the winning draft", async () => {
  const db = database();
  const DB = makeD1(db);
  await save(DB, ["reg-a", "reg-b", "reg-c"], "2026-11-06T12:00:00.000Z");

  const attempts = await Promise.allSettled([
    save(DB, ["reg-a", "reg-c", "reg-b"], "2026-11-06T12:01:00.000Z"),
    save(DB, ["reg-b", "reg-a", "reg-c"], "2026-11-06T12:01:00.001Z"),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = attempts.find((item) => item.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof D1PodiumDraftVersionConflict);
  const stored = db.prepare("SELECT registration_ids FROM zero3_podium_versions").get() as { registration_ids: string };
  assert.ok([
    JSON.stringify(["reg-a", "reg-c", "reg-b"]),
    JSON.stringify(["reg-b", "reg-a", "reg-c"]),
  ].includes(stored.registration_ids));
  db.close();
});

test("saving after publication creates a new draft and leaves the published version intact", async () => {
  const db = database();
  const DB = makeD1(db);
  await save(DB, ["reg-a", "reg-b", "reg-c"], "2026-11-06T12:00:00.000Z");
  db.prepare(`UPDATE zero3_podium_versions
    SET published=1,published_by='operator',published_at='2026-11-06T12:02:00.000Z'
    WHERE version=1`).run();

  const draft = await save(DB, ["reg-c", "reg-b", "reg-a"], "2026-11-06T12:03:00.000Z");
  assert.equal(draft.version, 2);
  assert.equal(draft.published, 0);
  assert.deepEqual(JSON.parse(String(db.prepare("SELECT registration_ids FROM zero3_podium_versions WHERE version=1").get()?.registration_ids)),
    ["reg-a", "reg-b", "reg-c"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions WHERE published=1").get()?.count, 1);
  db.close();
});

test("the un-applied arbitration-note migration is reported as schema-not-ready", async () => {
  const db = database({ arbitrationNote: false });
  await assert.rejects(
    saveD1PodiumDraft(makeD1(db), {
      eventId: "event-demo",
      category: "RX",
      registrationIds: ["reg-a", "reg-b", "reg-c"],
      arbitrationNote: null,
      updatedAt: "2026-11-06T12:00:00.000Z",
    }),
    (error: unknown) => classifyD1Failure(error) === "SCHEMA_NOT_READY",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM zero3_podium_versions").get()?.count, 0);
  db.close();
});

test("Cloudflare daily row quotas and unrelated D1 failures are classified separately", () => {
  const cases: Array<[Error, D1FailureKind]> = [
    [new Error("Your account has exceeded D1's free tier daily row read limit. Upgrade or wait until tomorrow."), "READ_QUOTA_EXCEEDED"],
    [new Error("Your account has exceeded D1's free tier daily row write limit. Upgrade or wait until tomorrow."), "WRITE_QUOTA_EXCEEDED"],
    [new Error("no such column: arbitration_note"), "SCHEMA_NOT_READY"],
    [new Error("database is locked"), "DATABASE_UNAVAILABLE"],
  ];
  for (const [error, expected] of cases) assert.equal(classifyD1Failure(error), expected);
});

test("D1 failure responses use service, schema, and quota statuses without returning raw errors", () => {
  const originalError = console.error;
  let logOutput = "";
  console.error = (...values: unknown[]) => { logOutput += values.join(" "); };
  try {
    const scenarios: Array<[Error, number, string]> = [
      [new Error("no such column: arbitration_note"), 503, "D1_SCHEMA_NOT_READY"],
      [new Error("Your account has exceeded D1's free tier daily row read limit."), 503, "D1_READ_QUOTA_EXCEEDED"],
      [new Error("Your account has exceeded D1's free tier daily row write limit."), 503, "D1_WRITE_QUOTA_EXCEEDED"],
      [new Error("UNIQUE constraint failed: zero3_podium_versions.event_id, zero3_podium_versions.category, zero3_podium_versions.version"), 409, "PODIUM_VERSION_CONFLICT"],
      [new Error("database is locked: Bearer private-test-value"), 503, "DATABASE_UNAVAILABLE"],
    ];
    for (const [failure, expectedStatus, expectedCode] of scenarios) {
      const { response, result } = mockResponse();
      respondD1Failure(
        { id: "request-test", method: "PUT", path: "/api/zero3/events/event-demo/podiums/RX" } as Request,
        response,
        failure,
        "podium_draft_save",
        "Falha segura de banco.",
      );
      const sent = result();
      assert.equal(sent.statusCode, expectedStatus);
      assert.equal((sent.body as { code: string }).code, expectedCode);
      assert.equal(JSON.stringify(sent.body).includes("private-test-value"), false);
    }
    assert.equal(logOutput.includes("private-test-value"), false);
  } finally {
    console.error = originalError;
  }
});

test("a missing D1 binding has a distinct 503 response before any Clerk or database lookup", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const { response, result } = mockResponse();
    const member = await requireD1Member(
      { id: "request-test", method: "PUT", path: "/api/zero3/events/event-demo/podiums/RX" } as Request,
      response,
      undefined as unknown as D1Database,
      ["ADMIN"],
    );
    assert.equal(member, null);
    const sent = result();
    assert.equal(sent.statusCode, 503);
    assert.equal((sent.body as { code: string }).code, "D1_BINDING_MISSING");
  } finally {
    console.error = originalError;
  }
});
