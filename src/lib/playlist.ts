import "server-only";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { NetError, safeFetchText } from "./net";
import { songKey } from "./songs";

/**
 * One-link import: read a public playlist from Spotify's embed player page.
 * No keys and no sign-in. The embed page lists at most 100 songs, so longer
 * playlists are flagged as cut short and the person can paste the rest.
 */

const LINK_PREVIEW = { "User-Agent": "Mozilla/5.0 (compatible; AllTimers/1.0; link preview)", "Accept-Language": "en-US,en;q=0.9" };
export const EMBED_LIMIT = 100;

/** A playlist id from a share link, a spotify: URI, or a bare id. */
export function parsePlaylistInput(input: string): string | null {
  const t = input.trim();
  const m = t.match(/playlist[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/) ?? t.match(/^([A-Za-z0-9]{22})$/);
  return m?.[1] ?? null;
}

const EntitySchema = z.object({
  name: z.string(),
  subtitle: z.string().optional(),
  coverArt: z.object({ sources: z.array(z.object({ url: z.string() })) }).optional(),
  trackList: z
    .array(
      z.object({
        uri: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        duration: z.number().optional(),
      }),
    )
    .max(1000),
});

export type PlaylistTrack = { id: string; name: string; artists: string[]; durationMs: number | null };
export type Playlist = { id: string; name: string; owner: string | null; imageUrl: string | null; tracks: PlaylistTrack[]; total: number | null; truncated: boolean };

export class PlaylistError extends Error {}

export async function fetchPlaylist(id: string): Promise<Playlist> {
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new PlaylistError("That isn't a playlist link.");
  let embed: string;
  try {
    embed = (await safeFetchText(`https://open.spotify.com/embed/playlist/${id}`, { headers: LINK_PREVIEW, retries: 1 })).text;
  } catch (e) {
    if (e instanceof NetError && e.status === 404) throw new PlaylistError("Spotify can't find that playlist. It may be private: in Spotify, open it → ••• → Make public, then try again.");
    throw new PlaylistError("Spotify didn't answer. Try again in a minute.");
  }
  const m = embed.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new PlaylistError("Couldn't read that playlist. If it's private, open it in Spotify → ••• → Make public, then try again.");
  let raw: unknown;
  try {
    raw = (JSON.parse(m[1]) as { props?: { pageProps?: { state?: { data?: { entity?: unknown } } } } })?.props?.pageProps?.state?.data?.entity;
  } catch {
    throw new PlaylistError("Couldn't read that playlist.");
  }
  const parsed = EntitySchema.safeParse(raw);
  if (!parsed.success) throw new PlaylistError("Couldn't read that playlist. Is it public?");
  const e = parsed.data;

  const tracks: PlaylistTrack[] = [];
  const seen = new Set<string>();
  for (const t of e.trackList) {
    const tid = t.uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
    if (!tid || seen.has(tid)) continue; // episodes, local files, repeats
    seen.add(tid);
    tracks.push({
      id: tid,
      name: t.title.slice(0, 500),
      artists: (t.subtitle ?? "").split(/, |, /).map((a) => a.trim()).filter(Boolean).slice(0, 20),
      durationMs: t.duration ?? null,
    });
  }

  // the full playlist page says how many songs it really has
  let total: number | null = null;
  try {
    const page = (await safeFetchText(`https://open.spotify.com/playlist/${id}`, { headers: LINK_PREVIEW, retries: 0 })).text;
    const n = page.match(/<meta name="music:song_count" content="(\d+)"/)?.[1];
    total = n ? parseInt(n, 10) : null;
  } catch {
    total = null;
  }
  const truncated = total != null ? total > e.trackList.length : e.trackList.length >= EMBED_LIMIT;
  return {
    id,
    name: e.name.slice(0, 200),
    owner: e.subtitle?.slice(0, 100) ?? null,
    imageUrl: e.coverArt?.sources[0]?.url ?? null,
    tracks,
    total,
    truncated,
  };
}

/**
 * Save what the playlist told us about each song so the list can show it right away.
 * Marked 'playlist' (title + artists, no art yet); the background backfill fills in
 * covers and albums. Never overwrites better details we already have.
 */
export async function savePlaylistTracks(tracks: PlaylistTrack[]) {
  if (!tracks.length) return;
  const db = await getDb();
  const rows = tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artists: JSON.stringify(t.artists),
    album: "",
    durationMs: t.durationMs,
    songKey: songKey(t.name, t.artists),
    metaSource: "playlist" as const,
    fetchedAt: new Date(),
  }));
  for (let i = 0; i < rows.length; i += 200) await db.insert(schema.tracks).values(rows.slice(i, i + 200)).onConflictDoNothing();
}
