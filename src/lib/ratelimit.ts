import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export class RateLimited extends Error {
  constructor(readonly retryInSec: number) {
    super("Too many requests. Try again in a moment.");
    this.name = "RateLimited";
  }
}

/**
 * Fixed-window counter in Postgres, so it holds across serverless instances.
 * `limit` actions per `windowSec` for `key` (e.g. "import:<userId>").
 * One upsert per call; old windows are swept occasionally.
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const db = await getDb();
  const now = Date.now();
  const start = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const rows = await db
    .insert(schema.rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  if (Math.random() < 0.02) {
    await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(now - 86_400_000)));
  }
  const count = rows[0]?.count ?? 1;
  if (count > limit) {
    throw new RateLimited(Math.ceil((start.getTime() + windowSec * 1000 - now) / 1000));
  }
  return { remaining: limit - count };
}

/** For tests and admin tools: forget a key's counters. */
export async function resetRateLimit(key: string) {
  const db = await getDb();
  await db.delete(schema.rateLimits).where(and(eq(schema.rateLimits.key, key)));
}
