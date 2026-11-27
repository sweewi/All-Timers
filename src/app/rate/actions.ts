"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { RATING_BUCKETS } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { budget, parse, zTrackId } from "@/lib/guard";
import { placeRating, RatingError, removeRating, searchKnownTracks, setNote } from "@/lib/ratings";
import { parseTrackInput, resolveTracks } from "@/lib/spotify";
import { artistLine } from "@/lib/songs";

const PlaceSchema = z.object({
  trackId: zTrackId,
  bucket: z.enum(RATING_BUCKETS),
  above: zTrackId.nullable(),
  below: zTrackId.nullable(),
  comparisons: z.number().int().min(0).max(20),
});

export type PlaceResult = { ok: true; score: number; rank: number; total: number } | { ok: false; message: string };

export async function rateSong(input: z.input<typeof PlaceSchema>): Promise<PlaceResult> {
  const user = await requireUser();
  const v = parse(PlaceSchema, input);
  await budget("write", user.id);
  try {
    const r = await placeRating({ userId: user.id, ...v });
    refresh();
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof RatingError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function saveTake(trackId: string, note: string) {
  const user = await requireUser();
  const id = parse(zTrackId, trackId);
  const text = parse(z.string().max(600), note);
  await budget("write", user.id);
  await setNote(user.id, id, text);
  refresh();
}

export async function unrate(trackId: string) {
  const user = await requireUser();
  const id = parse(zTrackId, trackId);
  await budget("write", user.id);
  await removeRating(user.id, id);
  refresh();
}

export type FoundSong = { id: string; name: string; artists: string; imageUrl: string | null };

/** Find a song to rate: anything the site already knows, or a pasted Spotify link. */
export async function findSongs(q: string): Promise<FoundSong[]> {
  const user = await requireUser();
  const text = parse(z.string().max(500), q).trim();
  await budget("write", user.id);
  const ids = parseTrackInput(text).ids.slice(0, 5);
  const tracks = ids.length ? await resolveTracks(ids) : await searchKnownTracks(text);
  return tracks.map((t) => ({ id: t.id, name: t.name, artists: artistLine(t.artists), imageUrl: t.imageUrl }));
}
