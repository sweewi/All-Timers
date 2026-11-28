"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { budget, parse, zText, zTrackIds } from "@/lib/guard";
import { getList, saveList } from "@/lib/lists";
import { cardOf, ensureShareToken, getProfile, patchProfile, resetShareToken, zCard, type CardStyle } from "@/lib/profile";
import { fetchPlaylist, parsePlaylistInput, PlaylistError, savePlaylistTracks } from "@/lib/playlist";
import { backfillTracks } from "@/lib/spotify";
import { RateLimited } from "@/lib/ratelimit";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Track } from "@/db/schema";
import { artistLine } from "@/lib/songs";

/**
 * A list's identity: setting it in stone, the rules it's held to, the Spotify playlist
 * it lives in, the public share link and the share card. Everything acts on the
 * signed-in person's own list only.
 */

/** Declare the list done. A label and a moment: songs can still be added (and are announced). */
export async function setInStone(): Promise<{ ok: true; setAt: string; count: number; token: string } | { ok: false; message: string }> {
  const user = await requireUser();
  await budget("write", user.id);
  const list = await getList(user.id, "all_time");
  if (list.length < 3) return { ok: false, message: "Add at least three songs first." };
  const p = await getProfile(user.id);
  const setAt = p?.setAt ?? new Date();
  if (!p?.setAt) await patchProfile(user.id, { setAt });
  const token = await ensureShareToken(user.id);
  // no refresh here: the ceremony is still playing; it refreshes the page when it closes
  return { ok: true, setAt: setAt.toISOString(), count: list.length, token };
}

/** Take the label off (for a list that turned out not to be done). */
export async function unsetStone() {
  const user = await requireUser();
  await budget("write", user.id);
  await patchProfile(user.id, { setAt: null });
  refresh();
}

/** The rules the list is held to, in the person's own words. Empty clears them. */
export async function saveRules(textIn: string) {
  const user = await requireUser();
  const text = parse(zText(200), textIn).replace(/\s+/g, " ");
  await budget("write", user.id);
  await patchProfile(user.id, { rules: text || null });
  refresh();
  return text;
}

export async function saveCard(input: CardStyle) {
  const user = await requireUser();
  const card = parse(zCard, input);
  await budget("write", user.id);
  await patchProfile(user.id, { card: JSON.stringify(card) });
  return card;
}

/** The public link to this list, made on first use. */
export async function shareLink() {
  const user = await requireUser();
  await budget("share", user.id);
  return ensureShareToken(user.id);
}

/** Turn the public link off, or replace it with a new one (old links stop working). */
export async function setSharing(on: boolean) {
  const user = await requireUser();
  const want = parse(z.boolean(), on);
  await budget("share", user.id);
  await resetShareToken(user.id, want);
  refresh();
}

export async function currentCard() {
  const user = await requireUser();
  return cardOf(await getProfile(user.id));
}

// ---------------------------------------------------------------------------- Spotify playlist

export type PlaylistCheck =
  | { ok: true; name: string; fresh: { id: string; name: string; artists: string; imageUrl: string | null }[] }
  | { ok: false; message: string };

/**
 * Remember which Spotify playlist the list lives in. Songs already in it count as
 * seen, so only songs added later are offered.
 */
export async function linkPlaylist(input: string): Promise<PlaylistCheck> {
  const user = await requireUser();
  const id = parsePlaylistInput(parse(z.string().max(500), input));
  if (!id) return { ok: false, message: "Paste a Spotify playlist link (Share → Copy link in the Spotify app)." };
  try {
    await budget("import", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, message: "That's a lot of tries. Give it a few minutes." };
    throw e;
  }
  try {
    const pl = await fetchPlaylist(id);
    await patchProfile(user.id, { playlistId: id, playlistSeen: JSON.stringify(pl.tracks.map((t) => t.id)), playlistCheckedAt: new Date() });
    refresh();
    return { ok: true, name: pl.name, fresh: [] };
  } catch (e) {
    if (e instanceof PlaylistError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Look for songs added to the playlist since last time that aren't on either list yet. */
export async function checkPlaylist(): Promise<PlaylistCheck> {
  const user = await requireUser();
  const p = await getProfile(user.id);
  if (!p?.playlistId) return { ok: false, message: "No playlist linked yet." };
  try {
    await budget("import", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, message: "Checked a lot just now. Try again in a few minutes." };
    throw e;
  }
  try {
    const pl = await fetchPlaylist(p.playlistId);
    await savePlaylistTracks(pl.tracks);
    const seen = new Set<string>(safeIds(p.playlistSeen));
    const [all, deck] = await Promise.all([getList(user.id, "all_time"), getList(user.id, "on_deck")]);
    const have = new Set([...all, ...deck].map((e) => e.track.id));
    const fresh = pl.tracks.filter((t) => !seen.has(t.id) && !have.has(t.id));
    await patchProfile(user.id, { playlistCheckedAt: new Date() });
    after(() => backfillTracks(40));
    const known = fresh.length ? await knownTracks(fresh.map((t) => t.id)) : new Map<string, Track>();
    return {
      ok: true,
      name: pl.name,
      fresh: fresh.slice(0, 50).map((t) => ({
        id: t.id,
        name: known.get(t.id)?.name ?? t.name,
        artists: known.has(t.id) ? artistLine(known.get(t.id)!.artists) : t.artists.join(", "),
        imageUrl: known.get(t.id)?.imageUrl ?? null,
      })),
    };
  } catch (e) {
    if (e instanceof PlaylistError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Add chosen songs from the playlist to the bottom of the All-Time list, and mark every
 * offered song as seen so passed-over ones don't come back.
 */
export async function addFromPlaylist(addIn: string[], offeredIn: string[]) {
  const user = await requireUser();
  const add = parse(zTrackIds, addIn);
  const offered = parse(zTrackIds, offeredIn);
  await budget("write", user.id);
  const p = await getProfile(user.id);
  if (!p?.playlistId) throw new Error("No playlist linked.");
  const seen = new Set<string>(safeIds(p.playlistSeen));
  // only songs that were actually offered from the playlist can be added this way
  const ok = add.filter((id) => offered.includes(id) && !seen.has(id));
  const list = await getList(user.id, "all_time");
  const ids = list.map((e) => e.track.id);
  await saveList(user.id, "all_time", [...ids, ...ok.filter((id) => !ids.includes(id))]);
  for (const id of offered) seen.add(id);
  await patchProfile(user.id, { playlistSeen: JSON.stringify([...seen].slice(-2000)) });
  refresh();
  return ok.length;
}

async function knownTracks(ids: string[]) {
  const db = await getDb();
  const rows = await db.select().from(schema.tracks).where(inArray(schema.tracks.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

function safeIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9]{22}$/.test(x)) : [];
  } catch {
    return [];
  }
}
