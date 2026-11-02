import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  getRequestDatabaseContext,
  withRequestDatabaseContext,
} from "./request-context";
import { DatabaseConnectionUnavailableError } from "./database-connection-error";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export let pool: InstanceType<typeof Pool>;
let defaultDatabase: Database | undefined;

let activeConnectionString: string | undefined;
let hyperdrivePool: InstanceType<typeof Pool> | undefined;
let hyperdriveConnectionString: string | undefined;
const requestDatabasePools = new WeakMap<object, InstanceType<typeof Pool>>();

function createPool(
  connectionString: string,
  options: { max?: number } = {},
): InstanceType<typeof Pool> {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 15_000,
  });
  pool.on("error", (error: Error & { code?: string }) => {
    // pg emits idle-client errors on the pool. A listener prevents them from
    // becoming unhandled Worker-isolate errors; never log connection details.
    console.error("[db] Idle PostgreSQL client error", {
      name: error.name,
      code: error.code,
    });
  });
  return pool;
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

  const database = drizzle(hyperdrivePool, { schema });
  requestDatabasePools.set(database, hyperdrivePool);
  return database;
}

/**
 * Acquires one pooled client and runs the callback through a Drizzle handle
 * bound to that client. This lets callers measure connection acquisition
 * separately from the SQL work without adding a probe query.
 */
export async function withCurrentDatabaseClient<TResult>(
  callback: (database: Database) => Promise<TResult>,
  onConnected?: () => void,
): Promise<TResult> {
  const requestDatabase = getRequestDatabaseContext<Database>();
  const requestPool = requestDatabase
    ? requestDatabasePools.get(requestDatabase)
    : undefined;
  const activePool = requestPool ?? pool;

  if (!activePool) {
    throw new Error("No database pool is available in the current request context.");
  }

  const client = await activePool.connect().catch((cause: unknown) => {
    throw new DatabaseConnectionUnavailableError(cause);
  });
  try {
    onConnected?.();
    const database = drizzle(client, { schema }) as Database;
    return await callback(database);
  } finally {
    client.release();
  }
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
