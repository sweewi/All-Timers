import "server-only";
import { drizzle as drizzleNeon, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import path from "node:path";
import * as schema from "./schema";
import { isSandbox } from "@/lib/sandbox";

export type DB = NeonDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

/**
 * Production: Neon Postgres (DATABASE_URL). Local dev with no DATABASE_URL:
 * an embedded Postgres (PGlite) stored in ./.pglite, migrated on first use.
 */
async function createDb(): Promise<DB> {
  if (isSandbox()) return createSandboxDb();
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

/** Preview deployments: in-memory Postgres, migrated and filled with demo data on each cold start. */
async function createSandboxDb(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { seedDemo } = await import("./demo/seed");
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await seedDemo(db);
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!globalForDb.__db) globalForDb.__db = createDb();
  return globalForDb.__db;
}

export { schema };
