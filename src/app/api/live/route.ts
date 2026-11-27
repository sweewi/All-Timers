import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLiveNow } from "@/lib/listening";
import { rateLimit, RateLimited } from "@/lib/ratelimit";

/**
 * What the crew is playing right now. Signed-in members only, their own crew only.
 * The page polls this about once a minute while it's visible; each call refreshes
 * at most a few stale members from stats.fm, so the load stays flat as the crew grows.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });
  try {
    await rateLimit(`live:${user.id}`, 20, 60);
  } catch (e) {
    if (e instanceof RateLimited) return NextResponse.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": String(e.retryInSec) } });
    throw e;
  }
  const live = await getLiveNow(user.crewId, 3);
  return NextResponse.json({ live, at: Date.now() });
}
