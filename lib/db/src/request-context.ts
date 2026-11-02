import { AsyncLocalStorage } from "node:async_hooks";

const requestDatabaseContext = new AsyncLocalStorage<unknown>();

export function withRequestDatabaseContext<TDatabase, TResult>(
  database: TDatabase,
  callback: () => TResult,
): TResult {
  return requestDatabaseContext.run(database, callback);
}

export function getRequestDatabaseContext<TDatabase>():
  | TDatabase
  | undefined {
  return requestDatabaseContext.getStore() as TDatabase | undefined;
}
