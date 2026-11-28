"use server";

import { redirect } from "next/navigation";
import { and, eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db";
import { startSession, endSession, getCurrentUser, requireUser } from "@/lib/auth";
import { getList, saveList } from "@/lib/lists";
import { newId, newToken, pickColor, slugify } from "@/lib/ids";
import { REACTIONS, type ReactionKind } from "@/db/schema";
import { budget, clientAddress, parse, zId, zTrackId } from "@/lib/guard";
import { addMembership, getMembership, inGroup, shareAGroup } from "@/lib/groups";

async function uniqueHandle(name: string) {
  const db = await getDb();
  const base = slugify(name);
  const taken = new Set(
    (await db.select({ h: schema.users.handle }).from(schema.users).where(like(schema.users.handle, `${base}%`))).map(
      (r) => r.h,
    ),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** First run only: create the crew and its first member (the admin). */
export async function setupCrew(formData: FormData) {
  const db = await getDb();
  const existing = await db.select({ id: schema.crews.id }).from(schema.crews).limit(1);
  if (existing.length) redirect("/");
  await founderGroup(formData, "/?error=name");
}

/**
 * Someone new starts their own All-Timers (usually after seeing a friend's shared list):
 * a fresh group with them as its admin, signed in on this device. Rate limited per address.
 */
export async function startFresh(formData: FormData) {
  if (await getCurrentUser()) redirect("/");
  await founderGroup(formData, "/start?error=name");
}

async function founderGroup(formData: FormData, onError: string) {
  await budget("join", await clientAddress());
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) redirect(onError);
  const crewName = String(formData.get("crewName") || "").trim().replace(/\s+/g, " ").slice(0, 60) || `${name}'s All-Timers`;
  const db = await getDb();
  const crewId = newId();
  const userId = newId();
  const handle = await uniqueHandle(name);
  await db.transaction(async (tx) => {
    await tx.insert(schema.crews).values({ id: crewId, name: crewName, inviteCode: newToken(9) });
    await tx.insert(schema.users).values({ id: userId, crewId, name, handle, color: pickColor(0) });
    await tx.insert(schema.memberships).values({ userId, crewId, role: "admin" });
  });
  await startSession(userId);
  redirect("/me/import?first=1");
}

/** A signed-in member starts another group (they're its admin) and switches to it. */
export async function createGroup(formData: FormData) {
  const user = await requireUser();
  await budget("join", user.id);
  const name = String(formData.get("groupName") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) redirect("/settings?group=name#groups");
  const db = await getDb();
  const crewId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(schema.crews).values({ id: crewId, name, inviteCode: newToken(9) });
    await tx.insert(schema.memberships).values({ userId: user.id, crewId, role: "admin" });
    await tx.update(schema.users).set({ crewId }).where(eq(schema.users.id, user.id));
  });
  redirect("/settings#invite");
}

/** Look at another of your groups. Your list is the same everywhere; the plaza, feed and monthly list change. */
export async function switchGroup(crewIdIn: string) {
  const user = await requireUser();
  const crewId = parse(zId, crewIdIn);
  if (!(await getMembership(user.id, crewId))) throw new Error("Not a member");
  const db = await getDb();
  await db.update(schema.users).set({ crewId }).where(eq(schema.users.id, user.id));
  refresh();
}

/**
 * Join a crew from its invite link. If the link came from someone's origin story
 * ("Jack put me on to this"), the new member is credited on that origin.
 */
export async function joinCrew(formData: FormData) {
  const db = await getDb();
  await budget("join", await clientAddress());
  const code = String(formData.get("code") || "").slice(0, 64);
  const name = String(formData.get("name") || "").trim().slice(0, 40);
  const fromOriginRaw = String(formData.get("fromOrigin") || "");
  const fromOrigin = zId.safeParse(fromOriginRaw).success ? fromOriginRaw : "";
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.inviteCode, code)))[0];
  if (!crew) redirect("/");

  // already signed in: same person, one more group (your list comes with you)
  const me = await getCurrentUser();
  if (me) {
    await addMembership(me.id, crew.id, "member");
    await db.update(schema.users).set({ crewId: crew.id }).where(eq(schema.users.id, me.id));
    if (fromOrigin) await creditOrigin(fromOrigin, me.id, crew.id);
    redirect("/");
  }

  if (!name) redirect(`/join/${code}?error=name`);
  const count = (await db.select({ id: schema.users.id }).from(schema.users).where(inGroup(crew.id)))
    .length;
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    crewId: crew.id,
    name,
    handle: await uniqueHandle(name),
    color: pickColor(count),
  });
  await addMembership(userId, crew.id, "member");
  if (fromOrigin) await creditOrigin(fromOrigin, userId, crew.id);
  await startSession(userId);
  redirect("/me/import?first=1");
}

/** "Jack put me on to this": the invited person gets the credit, if Jack is in that group. */
async function creditOrigin(originId: string, newcomerId: string, crewId: string) {
  const db = await getDb();
  const origin = (await db.select().from(schema.origins).where(eq(schema.origins.id, originId)))[0];
  if (!origin || origin.fromUserId || origin.userId === newcomerId) return;
  if (!(await getMembership(origin.userId, crewId))) return;
  await db
    .update(schema.origins)
    .set({ fromUserId: newcomerId, fromName: null, foundVia: "friend", updatedAt: new Date() })
    .where(eq(schema.origins.id, origin.id));
}

export async function signOut() {
  await endSession();
  redirect("/");
}

/**
 * "Steal it": put a friend's song on your On Deck, credited to them as a put-on.
 * Never touches your All-Time order; you decide if it climbs in.
 */
export async function stealSong(trackIdIn: string, fromUserIdIn: string) {
  const user = await requireUser();
  const trackId = parse(zTrackId, trackIdIn);
  const fromUserId = parse(zId, fromUserIdIn);
  await budget("write", user.id);
  const db = await getDb();
  const giver = (await db.select().from(schema.users).where(eq(schema.users.id, fromUserId)))[0];
  if (!giver || giver.id === user.id || !(await shareAGroup(user.id, giver.id))) return { ok: false as const };
  const [allTime, onDeck] = await Promise.all([getList(user.id, "all_time"), getList(user.id, "on_deck")]);
  if ([...allTime, ...onDeck].some((e) => e.track.id === trackId)) return { ok: true as const, already: true };
  await saveList(user.id, "on_deck", [...onDeck.map((e) => e.track.id), trackId]);
  const existing = await db
    .select({ id: schema.origins.id })
    .from(schema.origins)
    .where(and(eq(schema.origins.userId, user.id), eq(schema.origins.trackId, trackId)));
  if (!existing.length) {
    await db.insert(schema.origins).values({ id: newId(), userId: user.id, trackId, fromUserId, foundVia: "friend" });
  }
  refresh();
  return { ok: true as const, already: false };
}

/** Toggle one reaction (laurel, fire, cry, same) on a song or a batch of moves. */
export async function toggleReaction(target: string, kind: string) {
  const user = await requireUser();
  await budget("write", user.id);
  if (!/^(song|moves):[\w:-]{1,160}$/.test(target) || !(REACTIONS as readonly string[]).includes(kind)) return { ok: false as const };
  const db = await getDb();
  // only on things that belong to someone else in one of this person's groups
  const [type, a] = target.split(":");
  const ownerId =
    type === "moves"
      ? (await db.select({ u: schema.rankEvents.userId }).from(schema.rankEvents).where(eq(schema.rankEvents.batchId, a)).limit(1))[0]?.u
      : a;
  if (!ownerId || ownerId === user.id || !(await shareAGroup(user.id, ownerId))) return { ok: false as const };
  const mine = and(
    eq(schema.reactions.userId, user.id),
    eq(schema.reactions.target, target),
    eq(schema.reactions.kind, kind as ReactionKind),
  );
  const had = await db.select({ id: schema.reactions.id }).from(schema.reactions).where(mine);
  if (had.length) await db.delete(schema.reactions).where(mine);
  else await db.insert(schema.reactions).values({ id: newId(), userId: user.id, target, kind: kind as ReactionKind }).onConflictDoNothing();
  return { ok: true as const, on: !had.length };
}

/** The first-run guide was finished or closed: don't open it by itself again. */
export async function markGuideSeen() {
  const user = await requireUser();
  if (user.guideSeenAt) return;
  const db = await getDb();
  await db.update(schema.users).set({ guideSeenAt: new Date() }).where(eq(schema.users.id, user.id));
}
