import "server-only";
import { eq, inArray, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Track } from "@/db/schema";
import { z } from "zod";
import { songKey } from "./songs";
import { safeFetchJson, safeFetchText } from "./net";

const TokenSchema = z.object({ access_token: z.string().min(10), expires_in: z.number(), refresh_token: z.string().optional() });

async function tokenRequest(body: string) {
  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  try {
    const { data } = await safeFetchJson("https://accounts.spotify.com/api/token", TokenSchema, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      retries: 1,
      maxBytes: 20_000,
    });
    return data;
  } catch (e) {
    console.error("spotify token", { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

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
  const json = await tokenRequest("grant_type=client_credentials");
  if (!json) return null;
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
  const json = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.value }).toString());
  if (!json) return null;
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

const ApiTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.object({ name: z.string() })),
  album: z.object({
    name: z.string(),
    release_date: z.string().optional(),
    images: z.array(z.object({ url: z.string(), width: z.number().nullable().transform((w) => w ?? 0) })).optional(),
  }),
  duration_ms: z.number(),
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
});

async function fetchFromApi(id: string, token: string): Promise<SpotifyTrack | null> {
  try {
    const { data } = await safeFetchJson(`https://api.spotify.com/v1/tracks/${id}`, ApiTrackSchema, {
      headers: { Authorization: `Bearer ${token}` },
      retries: 1,
      maxBytes: 200_000,
    });
    return data;
  } catch {
    return null;
  }
}

async function fetchFromOEmbed(id: string) {
  try {
    const { data: json } = await safeFetchJson(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
      z.object({ title: z.string().optional(), thumbnail_url: z.string().optional() }),
      { retries: 1, maxBytes: 50_000 },
    );
    return json.title ? { title: json.title, image: json.thumbnail_url ?? null } : null;
  } catch {
    return null;
  }
}

// Identify as a link-preview fetcher: Spotify serves its plain-HTML page (with the
// og: tags) to those, and its JavaScript app to full browsers.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; AllTimers/1.0; link preview)",
  "Accept-Language": "en-US,en;q=0.9",
};

type PageTrack = {
  name: string;
  artists: string[];
  album: string;
  year: number | null;
  durationMs: number | null;
  imageUrl: string | null;
  color: string | null;
};

type Rgba = { red: number; green: number; blue: number };
const toHex = (c?: Rgba) =>
  c ? `#${[c.red, c.green, c.blue].map((n) => n.toString(16).padStart(2, "0")).join("")}` : null;

const decodeHtml = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/**
 * Song details from Spotify's public pages: the embed player page (title, every
 * artist, release date, duration, cover art, the art's background color) and the
 * track page (album name). Needs no API keys, so it works however Spotify's API
 * rules change. No ISRC here; that only comes from the API.
 */
async function fetchFromPublicPages(id: string): Promise<PageTrack | null> {
  try {
    const [embedRes, pageRes] = await Promise.all([
      safeFetchText(`https://open.spotify.com/embed/track/${id}`, { headers: BROWSER_HEADERS, retries: 1 }),
      safeFetchText(`https://open.spotify.com/track/${id}`, { headers: BROWSER_HEADERS, retries: 1 }).catch(() => null),
    ]);
    const html = embedRes.text;
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
    if (!entity?.name) return null;
    const images: { url: string; maxWidth?: number }[] = entity.visualIdentity?.image ?? [];
    const image =
      [...images].sort((a, b) => (a.maxWidth ?? 0) - (b.maxWidth ?? 0)).find((i) => (i.maxWidth ?? 0) >= 300) ??
      images[images.length - 1];
    const iso: string | undefined = entity.releaseDate?.isoString;

    let album = "";
    if (pageRes) {
      const page = pageRes.text;
      const desc = page.match(/<meta property="og:description" content="([^"]*)"/)?.[1];
      if (desc) {
        // "Artist A, Artist B · Album Name · Song · 1987"
        const parts = decodeHtml(desc).split(" · ");
        if (parts.length >= 4 && parts[parts.length - 2] === "Song") album = parts.slice(1, -2).join(" · ");
      }
    }
    return {
      name: entity.name,
      artists: (entity.artists ?? []).map((a: { name: string }) => a.name),
      album,
      year: iso ? parseInt(iso.slice(0, 4), 10) : null,
      durationMs: typeof entity.duration === "number" ? entity.duration : null,
      imageUrl: image?.url ?? null,
      color: toHex(entity.visualIdentity?.backgroundBase),
    };
  } catch {
    return null;
  }
}

async function resolveOne(id: string): Promise<typeof schema.tracks.$inferInsert> {
  // Spotify allows only single-track lookups for apps like this one, so one call per song.
  const tokens = [await getAppToken(), await getOwnerToken()].filter(Boolean) as string[];
  const pagePromise = fetchFromPublicPages(id);
  let api: SpotifyTrack | null = null;
  for (const token of tokens) {
    try {
      api = await fetchFromApi(id, token);
    } catch {
      api = null;
    }
    if (api) break;
  }
  const page = await pagePromise;

  if (api) {
    const artists = api.artists.map((a) => a.name);
    const images = [...(api.album.images ?? [])].sort((a, b) => a.width - b.width);
    const img = images.find((i) => i.width >= 200) ?? images[images.length - 1];
    const year = api.album.release_date ? parseInt(api.album.release_date.slice(0, 4), 10) : null;
    return {
      id,
      name: api.name,
      artists: JSON.stringify(artists),
      album: api.album.name,
      imageUrl: img?.url ?? page?.imageUrl ?? null,
      releaseYear: Number.isFinite(year) ? year : null,
      durationMs: api.duration_ms,
      isrc: api.external_ids?.isrc ?? null,
      songKey: songKey(api.name, artists),
      color: page?.color ?? null,
      metaSource: "spotify",
      fetchedAt: new Date(),
    };
  }
  if (page) {
    return {
      id,
      name: page.name,
      artists: JSON.stringify(page.artists),
      album: page.album,
      imageUrl: page.imageUrl,
      releaseYear: page.year,
      durationMs: page.durationMs,
      songKey: songKey(page.name, page.artists),
      color: page.color,
      metaSource: "page",
      fetchedAt: new Date(),
    };
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

const GOOD = new Set(["spotify", "page"]);

/** Return tracks for these IDs (in the same order), looking up and caching any we haven't seen. */
export async function resolveTracks(ids: string[], opts: { upgrade?: boolean } = {}): Promise<Track[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const cached = await db.select().from(schema.tracks).where(inArray(schema.tracks.id, ids));
  const byId = new Map(cached.map((t) => [t.id, t]));
  // Re-try anything we only got partial data for last time.
  const missing = ids.filter((id) => {
    const t = byId.get(id);
    if (!t) return true;
    return opts.upgrade ? t.metaSource !== "spotify" : !GOOD.has(t.metaSource);
  });

  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(chunk.map(resolveOne));
    for (const row of rows) {
      const existing = byId.get(row.id);
      if (existing && existing.metaSource === "spotify") continue;
      if (existing && existing.metaSource === "page" && row.metaSource !== "spotify" && existing.album) continue;
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

/**
 * Re-look-up songs saved with partial details (title only), e.g. from before this
 * fix. Called after pages render, a batch at a time, so lists heal on their own.
 */
export async function backfillTracks(limit = 40) {
  const db = await getDb();
  const partial = await db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .where(notInArray(schema.tracks.metaSource, ["spotify", "page", "statsfm"]))
    .limit(limit);
  if (partial.length) await resolveTracks(partial.map((t) => t.id));
  return partial.length;
}

export const SPOTIFY_SCOPES = "playlist-modify-public playlist-modify-private";
