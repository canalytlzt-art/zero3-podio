import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export let pool: InstanceType<typeof Pool>;
export let db: Database;

let activeConnectionString: string | undefined;

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

  pool = new Pool({
    connectionString,
    ...(options.max ? { max: options.max } : {}),
  });
  db = drizzle(pool, { schema });
  activeConnectionString = connectionString;
}

if (
  process.env.ZERO3_CLOUDFLARE_WORKER !== "true" &&
  process.env.DATABASE_URL
) {
  configureDatabase(process.env.DATABASE_URL);
}

export * from "./schema";
