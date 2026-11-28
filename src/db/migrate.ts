/**
 * Applies the SQL migrations in ./drizzle.
 * Runs automatically before `next build` (so Vercel migrates on every deploy).
 * With no DATABASE_URL it does nothing: local dev migrates the embedded DB on first use.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

async function main() {
  // Preview deployments use their own throwaway database (src/lib/sandbox.ts): never migrate the real one from a branch.
  if (process.env.VERCEL_ENV === "preview") {
    console.log("[db:migrate] Preview deployment: skipping (previews run on a sandbox database).");
    return;
  }
  console.log(`[db:migrate] Environment: ${process.env.VERCEL_ENV ?? "local"}`);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[db:migrate] No DATABASE_URL set; skipping (local dev uses the embedded database).");
    return;
  }
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("[db:migrate] Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
