"use server";

import { and, eq, inArray } from "drizzle-orm";
import { after } from "next/server";
import { getDb, schema } from "@/db";
import type { ListKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { saveList } from "@/lib/lists";
import { backfillTracks, parseTrackInput, resolveTracks } from "@/lib/spotify";
import { fetchPlaylist, parsePlaylistInput, PlaylistError, savePlaylistTracks } from "@/lib/playlist";
import { RateLimited } from "@/lib/ratelimit";
import { artistLine } from "@/lib/songs";
import { budget, parse, zKind, zTrackIds } from "@/lib/guard";
import { z } from "zod";

export type PreviewTrack = { id: string; name: string; artists: string; album: string; year: number | null; imageUrl: string | null; known: boolean };
export type PreviewResult = {
  tracks: PreviewTrack[];
  duplicates: number;
  playlists: number;
  unrecognized: number;
  alreadyOnList: number;
  /** set when a playlist link was read */
  playlist?: { name: string; imageUrl: string | null; total: number | null; truncated: boolean };
  /** what "replace" would do to the current list */
  diff: { added: number; removed: number; current: number };
  error?: string;
};

const EMPTY = { tracks: [], duplicates: 0, playlists: 0, unrecognized: 0, alreadyOnList: 0, diff: { added: 0, removed: 0, current: 0 } };

export async function previewImport(textIn: string, kindIn: ListKind): Promise<PreviewResult> {
  const user = await requireUser();
  const text = parse(z.string().max(200_000), textIn);
  const kind = parse(zKind, kindIn);
  try {
    await budget("import", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return { ...EMPTY, error: "That's a lot of imports. Give it a few minutes." };
    throw e;
  }
  const db = await getDb();
  const existing = await db
    .select({ trackId: schema.listEntries.trackId })
    .from(schema.listEntries)
    .where(and(eq(schema.listEntries.userId, user.id), eq(schema.listEntries.kind, kind)));
  const have = new Set(existing.map((e) => e.trackId));
  const diffOf = (ids: string[]) => {
    const next = new Set(ids);
    return { added: ids.filter((id) => !have.has(id)).length, removed: [...have].filter((id) => !next.has(id)).length, current: have.size };
  };

  // One link to a whole playlist: the phone-friendly way in.
  const playlistId = parsePlaylistInput(text);
  const trackLinks = parseTrackInput(text);
  if (playlistId && trackLinks.ids.length === 0) {
    try {
      const pl = await fetchPlaylist(playlistId);
      await savePlaylistTracks(pl.tracks);
      const ids = pl.tracks.map((t) => t.id);
      const rows = ids.length ? await db.select().from(schema.tracks).where(inArray(schema.tracks.id, ids)) : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        ...EMPTY,
        tracks: pl.tracks.map((t) => {
          const known = byId.get(t.id);
          return {
            id: t.id,
            name: known?.name ?? t.name,
            artists: known ? artistLine(known.artists) : t.artists.join(", "),
            album: known?.album ?? "",
            year: known?.releaseYear ?? null,
            imageUrl: known?.imageUrl ?? null,
            known: true,
          };
        }),
        alreadyOnList: ids.filter((id) => have.has(id)).length,
        playlist: { name: pl.name, imageUrl: pl.imageUrl, total: pl.total, truncated: pl.truncated },
        diff: diffOf(ids),
      };
    } catch (e) {
      if (e instanceof PlaylistError) return { ...EMPTY, playlists: 1, error: e.message };
      throw e;
    }
  }

  const tracks = await resolveTracks(trackLinks.ids.slice(0, 300));
  return {
    tracks: tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artists: artistLine(t.artists),
      album: t.album,
      year: t.releaseYear,
      imageUrl: t.imageUrl,
      known: t.metaSource !== "none",
    })),
    duplicates: trackLinks.duplicates,
    playlists: trackLinks.playlists,
    unrecognized: trackLinks.unrecognized,
    alreadyOnList: tracks.filter((t) => have.has(t.id)).length,
    diff: diffOf(tracks.map((t) => t.id)),
  };
}

/** replace: the pasted order becomes the list. append: new songs go to the bottom. */
export async function saveImport(kindIn: ListKind, idsIn: string[], modeIn: "replace" | "append") {
  const user = await requireUser();
  const kind = parse(zKind, kindIn);
  const ids = parse(zTrackIds, idsIn);
  const mode = parse(z.enum(["replace", "append"]), modeIn);
  await budget("import", user.id);
  const db = await getDb();
  let order = ids;
  if (mode === "append") {
    const existing = await db
      .select({ trackId: schema.listEntries.trackId, position: schema.listEntries.position })
      .from(schema.listEntries)
      .where(and(eq(schema.listEntries.userId, user.id), eq(schema.listEntries.kind, kind)));
    const current = existing.sort((a, b) => a.position - b.position).map((e) => e.trackId);
    const have = new Set(current);
    order = [...current, ...ids.filter((id) => !have.has(id))];
  }
  // Tracks must exist before entries reference them. Previews already saved them;
  // anything still missing is looked up now, and partial details heal in the background.
  const known = new Set(
    order.length ? (await db.select({ id: schema.tracks.id }).from(schema.tracks).where(inArray(schema.tracks.id, order))).map((r) => r.id) : [],
  );
  const missing = order.filter((id) => !known.has(id));
  if (missing.length) await resolveTracks(missing.slice(0, 300));
  const exists = new Set([...known, ...missing]);
  await saveList(user.id, kind, order.filter((id) => exists.has(id)));
  after(() => backfillTracks(120));
  return { handle: user.handle };
}
