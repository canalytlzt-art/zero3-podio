import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  getRequestDatabaseContext,
  withRequestDatabaseContext,
} from "./request-context";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export let pool: InstanceType<typeof Pool>;
let defaultDatabase: Database | undefined;

let activeConnectionString: string | undefined;
let hyperdrivePool: InstanceType<typeof Pool> | undefined;
let hyperdriveConnectionString: string | undefined;

function createPool(
  connectionString: string,
  options: { max?: number } = {},
): InstanceType<typeof Pool> {
  return new Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 15_000,
  });
}

export function configureDatabase(
  connectionString = process.env.DATABASE_URL,
  options: { max?: number } = {},
): void {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL or a Cloudflare Hyperdrive connection string is required.",
    );
  }
  if (activeConnectionString) {
    if (activeConnectionString !== connectionString) {
      throw new Error("The database connection cannot change at runtime.");
    }
    return;
  }

  pool = createPool(connectionString, options);
  defaultDatabase = drizzle(pool, { schema });
  activeConnectionString = connectionString;
}

/**
 * Creates a request-scoped Drizzle handle backed by the isolate's shared,
 * concurrency-safe Hyperdrive pool. Only the pool is shared; request context
 * is carried independently by AsyncLocalStorage.
 */
export function createRequestDatabase(
  connectionString: string,
  options: { max?: number } = {},
): Database {
  if (!connectionString) {
    throw new Error("A Cloudflare Hyperdrive connection string is required.");
  }

  if (!hyperdrivePool) {
    hyperdrivePool = createPool(connectionString, { max: options.max ?? 5 });
    hyperdriveConnectionString = connectionString;
  } else if (hyperdriveConnectionString !== connectionString) {
    throw new Error("The Hyperdrive binding changed within a Worker isolate.");
  }

  return drizzle(hyperdrivePool, { schema });
}

export function withDatabaseContext<T>(
  database: Database,
  callback: () => T,
): T {
  return withRequestDatabaseContext(database, callback);
}

export function getCurrentDatabase(): Database {
  const database =
    getRequestDatabaseContext<Database>() ?? defaultDatabase;
  if (!database) {
    throw new Error("No database is available in the current request context.");
  }
  return database;
}

export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = getCurrentDatabase();
    const value = Reflect.get(database, property, database) as unknown;
    return typeof value === "function" ? value.bind(database) : value;
  },
});

if (
  process.env.ZERO3_CLOUDFLARE_WORKER !== "true" &&
  process.env.DATABASE_URL
) {
  configureDatabase(process.env.DATABASE_URL);
}

export * from "./schema";
