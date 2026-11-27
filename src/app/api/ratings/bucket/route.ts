import { NextResponse, type NextRequest } from "next/server";
import { RATING_BUCKETS, type RatingBucket } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { artistLine } from "@/lib/songs";
import { getBucket } from "@/lib/ratings";

/** The signed-in person's songs in one bucket, best first: what a new song gets compared against. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const b = req.nextUrl.searchParams.get("b") as RatingBucket;
  if (!RATING_BUCKETS.includes(b)) return NextResponse.json({ error: "bad bucket" }, { status: 400 });
  const rows = await getBucket(user.id, b);
  return NextResponse.json({
    songs: rows.map((r) => ({ id: r.trackId, name: r.track.name, artists: artistLine(r.track.artists), imageUrl: r.track.imageUrl, score: r.score })),
  });
}
