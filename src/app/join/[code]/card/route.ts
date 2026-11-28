import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCrewOverview } from "@/lib/lists";
import { renderGroupCard } from "@/lib/card";
import { siteHost } from "@/lib/card-data";
import { budget, clientAddress } from "@/lib/guard";
import { RateLimited } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** The invite's link preview: anyone holding the invite already sees the group's name and members on the join page. */
export async function GET(req: NextRequest, ctx: RouteContext<"/join/[code]/card">) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(code)) return new NextResponse("Not found", { status: 404 });
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.inviteCode, code)))[0];
  if (!crew) return new NextResponse("Not found", { status: 404 });
  try {
    await budget("render", `ip:${await clientAddress()}`);
  } catch (e) {
    if (e instanceof RateLimited) return new NextResponse("Slow down", { status: 429, headers: { "Retry-After": "60" } });
    throw e;
  }
  const overview = await getCrewOverview(crew.id);
  return renderGroupCard(
    {
      group: crew.name,
      members: overview.map((o) => ({ name: o.member.name, color: o.member.color, cover: o.top[0]?.imageUrl ?? null, count: o.count })),
      site: siteHost(req),
    },
    { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", "X-Robots-Tag": "noindex" },
  );
}
