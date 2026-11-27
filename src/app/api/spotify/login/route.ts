import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isSiteAdmin } from "@/lib/groups";
import { newToken } from "@/lib/ids";
import { SPOTIFY_SCOPES } from "@/lib/spotify";

/** Admin connects their own Spotify account (one-time) so the app can act for them. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!user || !(await isSiteAdmin(user.id)) || !clientId) return NextResponse.redirect(new URL("/settings", request.url));
  const state = newToken(16);
  (await cookies()).set("spotify_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/spotify" });
  const redirectUri = new URL("/api/spotify/callback", request.url).toString();
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  }).toString();
  return NextResponse.redirect(url);
}
