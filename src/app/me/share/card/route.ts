import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { renderCard } from "@/lib/card";
import { cardDataFor, cardRequest, siteHost } from "@/lib/card-data";
import { budget } from "@/lib/guard";
import { RateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** The signed-in person's own card, drawn with whatever style the studio is trying. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });
  try {
    await budget("render", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return new NextResponse("Slow down", { status: 429, headers: { "Retry-After": "30" } });
    throw e;
  }
  const profile = await getProfile(user.id);
  const { style, format } = cardRequest(new URL(req.url), profile?.card ?? null);
  const data = await cardDataFor(user, siteHost(req));
  const dl = new URL(req.url).searchParams.get("download") === "1";
  return renderCard(data, style, format, {
    "Cache-Control": "private, no-store",
    ...(dl ? { "Content-Disposition": `attachment; filename="all-timers-${user.handle}-${format}.png"` } : {}),
  });
}
