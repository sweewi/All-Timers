"use server";

import { eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createLoginLink, requireUser } from "@/lib/auth";
import { resolveTracks } from "@/lib/spotify";
import { after } from "next/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { budget, parse, zId } from "@/lib/guard";
import { RateLimited } from "@/lib/ratelimit";
import { mirrorCrew } from "@/lib/mirror";
import { connectStatsfm, disconnectStatsfm, refreshListening, setSwitches } from "@/lib/listening";

export async function makeMyLoginLink() {
  const user = await requireUser();
  await budget("link", user.id);
  return createLoginLink(user.id);
}

/** Admin only: rescue a member who lost their signed-in devices. */
export async function makeLoginLinkFor(userIdIn: string) {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  const userId = parse(zId, userIdIn);
  await budget("link", admin.id);
  const db = await getDb();
  const member = (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0];
  if (!member || member.crewId !== admin.crewId) throw new Error("Not found");
  return createLoginLink(member.id);
}

/** Admin only: re-look-up songs that were saved before Spotify keys were set (title-only data). */
export async function refreshSongDetails() {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  const db = await getDb();
  const partial = await db.select({ id: schema.tracks.id }).from(schema.tracks).where(ne(schema.tracks.metaSource, "spotify"));
  const ids = partial.map((t) => t.id);
  const after = await resolveTracks(ids, { upgrade: true });
  const fixed = after.filter((t) => t.metaSource === "spotify" || t.metaSource === "page").length;
  return `${fixed} of ${ids.length} songs updated`;
}

// ---------------------------------------------------------------------------- stats.fm

export type StatsfmActionResult = { ok: true } | { ok: false; message: string };

/** Link your stats.fm profile by username or link. Your first sync runs after the response. */
export async function connectStatsfmAction(input: string): Promise<StatsfmActionResult> {
  const user = await requireUser();
  const text = parse(z.string().max(300), input);
  try {
    await budget("statsfm", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, message: "That's a lot of tries. Give it a few minutes." };
    throw e;
  }
  const r = await connectStatsfm(user.id, text);
  if (!r.ok) return { ok: false, message: r.message };
  after(() => refreshListening(user.id, { force: true }));
  refresh();
  return { ok: true };
}

export async function disconnectStatsfmAction() {
  const user = await requireUser();
  await disconnectStatsfm(user.id);
  refresh();
}

export async function setStatsfmSwitch(which: "showLive" | "showPlays", on: boolean) {
  const user = await requireUser();
  const key = parse(z.enum(["showLive", "showPlays"]), which);
  const val = parse(z.boolean(), on);
  await budget("write", user.id);
  await setSwitches(user.id, { [key]: val });
  refresh();
}

/** Pull fresh numbers now instead of waiting for the next scheduled refresh. */
export async function refreshStatsfmNow(): Promise<string> {
  const user = await requireUser();
  try {
    await budget("statsfm", user.id);
  } catch (e) {
    if (e instanceof RateLimited) return "Refreshed recently. Try again later.";
    throw e;
  }
  const r = await refreshListening(user.id, { force: true });
  refresh();
  return r.refreshed.length ? "Up to date" : "stats.fm didn't answer. We'll try again later.";
}

/** Admin only: push every column and finished month to the Spotify hub now. */
export async function syncSpotifyMirrors(): Promise<string> {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  await budget("link", admin.id);
  const r = await mirrorCrew(admin.crewId);
  if (r.skipped) return "Connect Spotify first.";
  return `${r.synced} playlists synced${r.failed ? `, ${r.failed} failed (see logs)` : ""}`;
}
