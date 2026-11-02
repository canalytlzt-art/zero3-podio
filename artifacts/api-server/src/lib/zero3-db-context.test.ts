import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRequestDatabaseContext,
  withRequestDatabaseContext,
} from "../../../../lib/db/src/request-context";

const database = (id: string) => ({ id });

test("keeps request database contexts isolated across concurrent work", async () => {
  const readWithinContext = async (selected: ReturnType<typeof database>, delayMs: number) =>
    withRequestDatabaseContext(selected, async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return getRequestDatabaseContext<typeof selected>();
    });

  const contexts = Array.from({ length: 24 }, (_, index) => database(`request-${index}`));
  const results = await Promise.all(
    contexts.map((context, index) =>
      readWithinContext(context, (index * 7) % 13),
    ),
  );

  results.forEach((result, index) => assert.equal(result, contexts[index]));
});

test("keeps sequential requests on their own database context", async () => {
  const first = database("first");
  const second = database("second");

  assert.equal(
    withRequestDatabaseContext(first, () => getRequestDatabaseContext<typeof first>()),
    first,
  );
  assert.equal(
    withRequestDatabaseContext(second, () => getRequestDatabaseContext<typeof second>()),
    second,
  );
});
