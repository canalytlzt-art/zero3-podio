import assert from "node:assert/strict";
import test from "node:test";
import { zero3ImportBatchesTable } from "@workspace/db/schema";

test("import batch ORM uses the applied_at column from the PostgreSQL schema", () => {
  assert.equal(zero3ImportBatchesTable.appliedAt.name, "applied_at");
});
