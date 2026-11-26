import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const back = (status: string) => NextResponse.redirect(new URL(`/settings?spotify=${status}`, request.url));
  if (!user?.isAdmin) return back("error");

  const params = request.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("spotify_state")?.value;
  jar.delete("spotify_state");
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return back("error");

  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/api/spotify/callback", request.url).toString(),
    }),
    cache: "no-store",
  });
  if (!res.ok) return back("error");
  const json = (await res.json()) as { refresh_token?: string };
  if (!json.refresh_token) return back("error");

  const db = await getDb();
  await db
    .insert(schema.settings)
    .values({ key: "spotify_refresh_token", value: json.refresh_token })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json.refresh_token, updatedAt: new Date() } });
  return back("connected");
}
