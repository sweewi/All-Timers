"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db";
import { FOUND_VIA, type FoundVia, type ListKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getList, saveList } from "@/lib/lists";
import { newId } from "@/lib/ids";
import { hasListened } from "@/lib/listening";
import { queueColumnMirror } from "@/lib/mirror";
import { budget, parse, zId, zKind, zTrackId, zTrackIds } from "@/lib/guard";
import { z } from "zod";

export async function saveOrder(kindIn: ListKind, idsIn: string[]) {
  const user = await requireUser();
  const kind = parse(zKind, kindIn);
  const ids = parse(zTrackIds, idsIn);
  await budget("write", user.id);
  // a reorder can only rearrange or drop songs already on your lists, never invent new rows
  const mine = new Set([...(await getList(user.id, "all_time")), ...(await getList(user.id, "on_deck"))].map((e) => e.track.id));
  if (ids.some((id) => !mine.has(id))) throw new Error("Unknown song in that order.");
  await saveList(user.id, kind, ids);
  if (kind === "all_time") queueColumnMirror(user.id);
  refresh();
}

/** Move a song between All-Time and On Deck. It lands at the bottom of the other list. */
export async function moveToList(trackIdIn: string, fromIn: ListKind, toIn: ListKind) {
  const user = await requireUser();
  const trackId = parse(zTrackId, trackIdIn);
  const from = parse(zKind, fromIn);
  const to = parse(zKind, toIn);
  if (from === to) return;
  await budget("write", user.id);
  const [src, dst] = await Promise.all([getList(user.id, from), getList(user.id, to)]);
  if (!src.some((e) => e.track.id === trackId)) return;
  const dstIds = dst.map((e) => e.track.id);
  if (!dstIds.includes(trackId)) await saveList(user.id, to, [...dstIds, trackId]);
  await saveList(
    user.id,
    from,
    src.map((e) => e.track.id).filter((id) => id !== trackId),
  );
  queueColumnMirror(user.id);
  refresh();
}

export type OriginInput = {
  trackId: string;
  foundVia: FoundVia | null;
  fromUserId: string | null;
  fromName: string | null;
  love: string;
  moment: string;
  whenText: string;
  story: string;
};

/**
 * Save the story behind a song. "A friend put me on" + a crew member makes it a
 * put-on. Naming someone who isn't in the app returns an origin id for an invite
 * link that credits them when they join.
 */
const OriginSchema = z.object({
  trackId: zTrackId,
  foundVia: z.string().nullable(),
  fromUserId: zId.nullable().or(z.literal("")),
  fromName: z.string().max(80).nullable(),
  love: z.string().max(4000),
  moment: z.string().max(4000),
  whenText: z.string().max(4000),
  story: z.string().max(4000),
});

export async function saveOrigin(raw: OriginInput) {
  const user = await requireUser();
  const input = parse(OriginSchema, raw) as OriginInput;
  await budget("write", user.id);
  const db = await getDb();
  const foundVia = input.foundVia && FOUND_VIA.includes(input.foundVia) ? input.foundVia : null;
  let fromUserId = foundVia === "friend" ? input.fromUserId || null : null;
  if (fromUserId) {
    const giver = (await db.select().from(schema.users).where(eq(schema.users.id, fromUserId)))[0];
    if (!giver || giver.crewId !== user.crewId || giver.id === user.id) fromUserId = null;
  }
  const fromName = foundVia === "someone" ? input.fromName?.trim().slice(0, 60) || null : null;
  const clean = (s: string) => s.trim().slice(0, 2000) || null;
  const values = {
    foundVia,
    fromUserId,
    fromName,
    love: clean(input.love),
    moment: clean(input.moment),
    whenText: clean(input.whenText),
    story: clean(input.story),
    updatedAt: new Date(),
  };
  const existing = (
    await db
      .select({ id: schema.origins.id })
      .from(schema.origins)
      .where(and(eq(schema.origins.userId, user.id), eq(schema.origins.trackId, input.trackId)))
  )[0];
  let id = existing?.id;
  if (id) {
    await db.update(schema.origins).set(values).where(eq(schema.origins.id, id));
  } else {
    id = newId();
    await db.insert(schema.origins).values({ id, userId: user.id, trackId: input.trackId, ...values });
  }
  refresh();
  return { originId: id, inviteName: fromName };
}

/**
 * Add a song you've been playing (per stats.fm) to the bottom of a list.
 * Only tracks we actually saw in your listening are accepted.
 */
export async function addFromListening(trackIdIn: string, kindIn: ListKind) {
  const user = await requireUser();
  const trackId = parse(zTrackId, trackIdIn);
  const kind = parse(zKind, kindIn);
  await budget("write", user.id);
  if (!(await hasListened(user.id, trackId))) throw new Error("Not in your listening.");
  const [allTime, onDeck] = await Promise.all([getList(user.id, "all_time"), getList(user.id, "on_deck")]);
  if ([...allTime, ...onDeck].some((e) => e.track.id === trackId)) return;
  const target = kind === "all_time" ? allTime : onDeck;
  await saveList(user.id, kind, [...target.map((e) => e.track.id), trackId]);
  refresh();
}
