"use server";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ListKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { saveList } from "@/lib/lists";
import { parseTrackInput, resolveTracks } from "@/lib/spotify";
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
};

export async function previewImport(textIn: string, kindIn: ListKind): Promise<PreviewResult> {
  const user = await requireUser();
  const text = parse(z.string().max(200_000), textIn);
  const kind = parse(zKind, kindIn);
  await budget("import", user.id);
  const parsed = parseTrackInput(text);
  const tracks = await resolveTracks(parsed.ids.slice(0, 300));
  const db = await getDb();
  const existing = await db
    .select({ trackId: schema.listEntries.trackId })
    .from(schema.listEntries)
    .where(and(eq(schema.listEntries.userId, user.id), eq(schema.listEntries.kind, kind)));
  const have = new Set(existing.map((e) => e.trackId));
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
    duplicates: parsed.duplicates,
    playlists: parsed.playlists,
    unrecognized: parsed.unrecognized,
    alreadyOnList: tracks.filter((t) => have.has(t.id)).length,
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
  // Tracks must exist before entries reference them.
  await resolveTracks(order);
  await saveList(user.id, kind, order);
  return { handle: user.handle };
}
