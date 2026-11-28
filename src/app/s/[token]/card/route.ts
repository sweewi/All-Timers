import { NextResponse, type NextRequest } from "next/server";
import { ownerOfShareToken } from "@/lib/profile";
import { renderCard } from "@/lib/card";
import { cardDataFor, cardRequest, siteHost } from "@/lib/card-data";
import { budget, clientAddress } from "@/lib/guard";
import { RateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * A public list's card as a PNG. Anyone with the share link can load it (that's what
 * link previews in group chats do), so it shows only what the public page shows, and
 * the CDN holds each version for an hour.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/s/[token]/card">) {
  const { token } = await ctx.params;
  const found = await ownerOfShareToken(token);
  if (!found) return new NextResponse("Not found", { status: 404 });
  try {
    await budget("render", `ip:${await clientAddress()}`);
  } catch (e) {
    if (e instanceof RateLimited) return new NextResponse("Slow down", { status: 429, headers: { "Retry-After": "60" } });
    throw e;
  }
  const { style, format } = cardRequest(new URL(req.url), found.profile.card);
  const data = await cardDataFor(found.user, siteHost(req));
  return renderCard(data, style, format, {
    "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    "X-Robots-Tag": "noindex",
  });
}
