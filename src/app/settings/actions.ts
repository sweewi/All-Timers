"use server";

import { eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createLoginLink, requireUser } from "@/lib/auth";
import { resolveTracks } from "@/lib/spotify";

export async function makeMyLoginLink() {
  const user = await requireUser();
  return createLoginLink(user.id);
}

/** Admin only: rescue a member who lost their signed-in devices. */
export async function makeLoginLinkFor(userId: string) {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
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
  const after = await resolveTracks(ids);
  const fixed = after.filter((t) => t.metaSource === "spotify").length;
  return `${fixed} of ${ids.length} songs updated`;
}
