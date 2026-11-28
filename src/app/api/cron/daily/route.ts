import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { refreshCrew, sweepOldListening } from "@/lib/listening";

export const maxDuration = 60;

/** Constant-time comparison of the bearer token against CRON_SECRET. */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = req.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/**
 * Once a day (Vercel Cron, see vercel.json): refresh stale stats.fm data politely and tidy up.
 * Every step is independent: one failing never stops the rest.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const crews = await db.select({ id: schema.crews.id }).from(schema.crews);
  const report: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report[name] = (await fn()) ?? "ok";
    } catch (e) {
      console.error("cron step failed", { name, err: String(e) });
      report[name] = "failed";
    }
  };
  for (const c of crews) await step(`listening:${c.id}`, () => refreshCrew(c.id));
  await step("sweep", sweepOldListening);
  await step("ratelimits", () => db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 86_400_000))));
  return NextResponse.json({ ok: true, report });
}
