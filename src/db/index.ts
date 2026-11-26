import "server-only";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

export type DB = NeonDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

/**
 * Production: Neon Postgres (DATABASE_URL). Local dev with no DATABASE_URL:
 * an embedded Postgres (PGlite) stored in ./.pglite, migrated on first use.
 */
async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzleNeon({ client: new Pool({ connectionString: url }), schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // Both drivers expose the same query builder; the result types differ only internally.
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!globalForDb.__db) globalForDb.__db = createDb();
  return globalForDb.__db;
}

export { schema };
