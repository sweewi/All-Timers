"use server";

import { redirect } from "next/navigation";
import { and, eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db";
import { startSession, endSession, requireUser } from "@/lib/auth";
import { getList, saveList } from "@/lib/lists";
import { newId, newToken, pickColor, slugify } from "@/lib/ids";
import { REACTIONS, type ReactionKind } from "@/db/schema";
import { budget, clientAddress, parse, zId, zTrackId } from "@/lib/guard";

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
  await budget("join", await clientAddress());
  const name = String(formData.get("name") || "").trim().slice(0, 40);
  const crewName = String(formData.get("crewName") || "").trim().slice(0, 60) || (name ? `${name}'s All-Timers` : "All-Timers");
  if (!name) redirect("/?error=name");
  const crewId = newId();
  await db.insert(schema.crews).values({ id: crewId, name: crewName, inviteCode: newToken(9) });
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    crewId,
    name,
    handle: await uniqueHandle(name),
    color: pickColor(0),
    isAdmin: true,
  });
  await startSession(userId);
  redirect("/me/import?first=1");
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
  if (!name) redirect(`/join/${code}?error=name`);
  const count = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.crewId, crew.id)))
    .length;
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    crewId: crew.id,
    name,
    handle: await uniqueHandle(name),
    color: pickColor(count),
  });
  if (fromOrigin) {
    const origin = (await db.select().from(schema.origins).where(eq(schema.origins.id, fromOrigin)))[0];
    if (origin && !origin.fromUserId) {
      const owner = (await db.select().from(schema.users).where(eq(schema.users.id, origin.userId)))[0];
      if (owner?.crewId === crew.id) {
        await db
          .update(schema.origins)
          .set({ fromUserId: userId, fromName: null, foundVia: "friend", updatedAt: new Date() })
          .where(eq(schema.origins.id, origin.id));
      }
    }
  }
  await startSession(userId);
  redirect("/me/import?first=1");
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
  if (!giver || giver.crewId !== user.crewId || giver.id === user.id) return { ok: false as const };
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
