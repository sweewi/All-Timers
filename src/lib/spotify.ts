import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Track } from "@/db/schema";
import { songKey } from "./songs";

/** Pull Spotify track IDs out of whatever people paste, in order, keeping duplicates out. */
export function parseTrackInput(text: string) {
  const ids: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let playlists = 0;
  let unrecognized = 0;
  for (const raw of text.split(/[\s,]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/track[/:]([A-Za-z0-9]{22})/);
    if (m) {
      if (seen.has(m[1])) duplicates++;
      else {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    } else if (/playlist[/:]/.test(line) || /album[/:]/.test(line)) playlists++;
    else if (/spotify|https?:/.test(line)) unrecognized++;
  }
  return { ids, duplicates, playlists, unrecognized };
}

// ---------------------------------------------------------------------------
// Tokens. Two routes into Spotify's Web API:
//  1. App token (client credentials): SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET.
//  2. The app owner's own token (refresh token saved when the owner clicks
//     "Connect Spotify" in Settings). Needed later for creating group playlists.
// If neither works, we fall back to Spotify's public oEmbed (title + cover art only).
// ---------------------------------------------------------------------------

let appToken: { value: string; expires: number } | null = null;

async function getAppToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (appToken && appToken.expires > Date.now() + 60_000) return appToken.value;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return appToken.value;
}

let ownerToken: { value: string; expires: number } | null = null;

export async function getOwnerToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (ownerToken && ownerToken.expires > Date.now() + 60_000) return ownerToken.value;
  const db = await getDb();
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.key, "spotify_refresh_token")))[0];
  if (!row) return null;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.value }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  if (json.refresh_token && json.refresh_token !== row.value) {
    await db
      .update(schema.settings)
      .set({ value: json.refresh_token, updatedAt: new Date() })
      .where(eq(schema.settings.key, "spotify_refresh_token"));
  }
  ownerToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return ownerToken.value;
}

type SpotifyTrack = {
  id: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; release_date?: string; images?: { url: string; width: number }[] };
  duration_ms: number;
  external_ids?: { isrc?: string };
};

async function fetchFromApi(id: string, token: string): Promise<SpotifyTrack | null> {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as SpotifyTrack;
}

async function fetchFromOEmbed(id: string) {
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; thumbnail_url?: string };
    return json.title ? { title: json.title, image: json.thumbnail_url ?? null } : null;
  } catch {
    return null;
  }
}

async function resolveOne(id: string): Promise<typeof schema.tracks.$inferInsert> {
  // Spotify allows only single-track lookups for apps like this one, so one call per song.
  const tokens = [await getAppToken(), await getOwnerToken()].filter(Boolean) as string[];
  for (const token of tokens) {
    let t: SpotifyTrack | null = null;
    try {
      t = await fetchFromApi(id, token);
    } catch {
      t = null;
    }
    if (t) {
      const artists = t.artists.map((a) => a.name);
      const images = [...(t.album.images ?? [])].sort((a, b) => a.width - b.width);
      const img = images.find((i) => i.width >= 200) ?? images[images.length - 1];
      const year = t.album.release_date ? parseInt(t.album.release_date.slice(0, 4), 10) : null;
      return {
        id,
        name: t.name,
        artists: JSON.stringify(artists),
        album: t.album.name,
        imageUrl: img?.url ?? null,
        releaseYear: Number.isFinite(year) ? year : null,
        durationMs: t.duration_ms,
        isrc: t.external_ids?.isrc ?? null,
        songKey: songKey(t.name, artists),
        metaSource: "spotify",
        fetchedAt: new Date(),
      };
    }
  }
  const o = await fetchFromOEmbed(id);
  if (o) {
    return {
      id,
      name: o.title,
      artists: "[]",
      album: "",
      imageUrl: o.image,
      songKey: songKey(o.title, []),
      metaSource: "oembed",
      fetchedAt: new Date(),
    };
  }
  return { id, name: "Unknown track", artists: "[]", songKey: `unknown|${id}`, metaSource: "none", fetchedAt: new Date() };
}

/** Return tracks for these IDs (in the same order), looking up and caching any we haven't seen. */
export async function resolveTracks(ids: string[]): Promise<Track[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const cached = await db.select().from(schema.tracks).where(inArray(schema.tracks.id, ids));
  const byId = new Map(cached.map((t) => [t.id, t]));
  // Re-try anything we only got partial data for last time.
  const missing = ids.filter((id) => !byId.has(id) || byId.get(id)!.metaSource !== "spotify");

  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(chunk.map(resolveOne));
    for (const row of rows) {
      const existing = byId.get(row.id);
      if (existing && existing.metaSource === "spotify") continue;
      if (existing && row.metaSource === "none") continue; // keep what we had
      await db
        .insert(schema.tracks)
        .values(row)
        .onConflictDoUpdate({ target: schema.tracks.id, set: { ...row } });
    }
  }
  const fresh = missing.length
    ? await db.select().from(schema.tracks).where(inArray(schema.tracks.id, ids))
    : cached;
  const freshById = new Map(fresh.map((t) => [t.id, t]));
  return ids.map((id) => freshById.get(id)).filter((t): t is Track => Boolean(t));
}

export const SPOTIFY_SCOPES = "playlist-modify-public playlist-modify-private";
