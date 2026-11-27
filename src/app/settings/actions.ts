"use server";

import { and, eq, inArray, like, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createLoginLink, requireUser } from "@/lib/auth";
import { resolveTracks } from "@/lib/spotify";
import { after } from "next/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { budget, parse, zId } from "@/lib/guard";
import { RateLimited } from "@/lib/ratelimit";
import { mirrorCrew, syncMonth } from "@/lib/mirror";
import { rebuildCurrentPool } from "@/lib/monthly";
import { adminCount, getMembership, isSiteAdmin, myGroups } from "@/lib/groups";
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

/** Site admin only: re-look-up songs that were saved before Spotify keys were set (title-only data). */
export async function refreshSongDetails() {
  const admin = await requireUser();
  if (!(await isSiteAdmin(admin.id))) throw new Error("Not allowed");
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
  after(async () => {
    await refreshListening(user.id, { force: true });
    const round = await rebuildCurrentPool(user.crewId);
    await syncMonth(round.id);
  });
  refresh();
  return { ok: true };
}

export async function disconnectStatsfmAction() {
  const user = await requireUser();
  await disconnectStatsfm(user.id);
  after(async () => {
    const round = await rebuildCurrentPool(user.crewId);
    await syncMonth(round.id);
  });
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
  const round = await rebuildCurrentPool(user.crewId);
  after(() => syncMonth(round.id));
  refresh();
  return r.refreshed.length ? "Up to date" : "stats.fm didn't answer. We'll try again later.";
}

/** Admin only: push this group's monthly playlists to the Spotify hub now. */
export async function syncSpotifyMirrors(): Promise<string> {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  await budget("link", admin.id);
  // bring this month's pool up to date first, so the playlist matches what people played
  await rebuildCurrentPool(admin.crewId);
  const r = await mirrorCrew(admin.crewId);
  if (r.skipped) return "Connect the hub account first.";
  if (r.failed) return `${r.synced} synced. ${r.errors.join(" ")}`;
  return r.synced ? `${r.synced} playlist${r.synced === 1 ? "" : "s"} synced` : "Nothing to sync yet: the pool is empty.";
}

// ---------------------------------------------------------------------------- members (admin)

async function requireAdminOver(memberIdIn: string) {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  const memberId = parse(zId, memberIdIn);
  await budget("write", admin.id);
  const db = await getDb();
  const member = (await db.select().from(schema.users).where(eq(schema.users.id, memberId)))[0];
  // admins act only on people in the group they're running
  if (!member || !(await getMembership(member.id, admin.crewId))) throw new Error("Not found");
  return { admin, member, db };
}

export async function setAdmin(memberId: string, makeAdmin: boolean): Promise<{ ok: boolean; message: string }> {
  const { admin, member, db } = await requireAdminOver(memberId);
  const on = parse(z.boolean(), makeAdmin);
  if (!on && (await getMembership(member.id, admin.crewId))?.role === "admin" && (await adminCount(admin.crewId)) <= 1) {
    return { ok: false, message: "There has to be at least one admin." };
  }
  await db
    .update(schema.memberships)
    .set({ role: on ? "admin" : "member" })
    .where(and(eq(schema.memberships.userId, member.id), eq(schema.memberships.crewId, admin.crewId)));
  refresh();
  return { ok: true, message: on ? `${member.name} is now an admin.` : `${member.name} is no longer an admin.` };
}

/**
 * Remove someone from this group: they stop seeing it and it stops seeing them, and
 * their votes in its monthly lists go. If this was their only group, their account
 * and everything they made goes too (lists, stories, moves, reactions, listening
 * data, sessions); credits they gave others become anonymous. Typed-name confirmation.
 */
export async function removeMember(memberId: string, typedName: string): Promise<{ ok: boolean; message: string }> {
  const { admin, member, db } = await requireAdminOver(memberId);
  if (member.id === admin.id) return { ok: false, message: "You can't remove yourself." };
  const typed = parse(z.string().max(100), typedName).trim().toLowerCase();
  if (typed !== member.name.trim().toLowerCase()) return { ok: false, message: `Type "${member.name}" to confirm.` };
  const groups = await myGroups(member.id);
  const elsewhere = groups.some((g) => g.crew.id !== admin.crewId);
  await db.transaction(async (tx) => {
    const rounds = await tx.select({ id: schema.monthlyRounds.id }).from(schema.monthlyRounds).where(eq(schema.monthlyRounds.crewId, admin.crewId));
    if (rounds.length) {
      await tx
        .delete(schema.monthlyBallots)
        .where(and(eq(schema.monthlyBallots.userId, member.id), inArray(schema.monthlyBallots.roundId, rounds.map((r) => r.id))));
    }
    await tx.delete(schema.memberships).where(and(eq(schema.memberships.userId, member.id), eq(schema.memberships.crewId, admin.crewId)));
    if (elsewhere) {
      // still in another group: their list lives on there; point them at it
      const next = groups.find((g) => g.crew.id !== admin.crewId)!;
      if (member.crewId === admin.crewId) await tx.update(schema.users).set({ crewId: next.crew.id }).where(eq(schema.users.id, member.id));
      return;
    }
    // reactions point at their songs and moves by key, not by foreign key, so clear them by hand
    const batches = await tx.selectDistinct({ b: schema.rankEvents.batchId }).from(schema.rankEvents).where(eq(schema.rankEvents.userId, member.id));
    await tx.delete(schema.reactions).where(like(schema.reactions.target, `song:${member.id}:%`));
    for (let i = 0; i < batches.length; i += 200) {
      const keys = batches.slice(i, i + 200).map((x) => `moves:${x.b}`);
      await tx.delete(schema.reactions).where(inArray(schema.reactions.target, keys));
    }
    // everything else is tied to the person and goes with them
    await tx.delete(schema.users).where(eq(schema.users.id, member.id));
  });
  after(async () => {
    const round = await rebuildCurrentPool(admin.crewId);
    await syncMonth(round.id);
  });
  refresh();
  return {
    ok: true,
    message: elsewhere ? `${member.name} was removed from this group (their other groups keep them).` : `${member.name} was removed.`,
  };
}

/** Admin only: rename the group (shown on the plaza, invites, and the monthly playlist). */
export async function renameGroup(nameIn: string): Promise<{ ok: boolean; message: string }> {
  const admin = await requireUser();
  if (!admin.isAdmin) throw new Error("Not allowed");
  const name = parse(z.string().max(200), nameIn).trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { ok: false, message: "The group needs a name." };
  await budget("write", admin.id);
  const db = await getDb();
  await db.update(schema.crews).set({ name }).where(eq(schema.crews.id, admin.crewId));
  refresh();
  return { ok: true, message: `Renamed to ${name}.` };
}
