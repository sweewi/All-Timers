"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema } from "@/db";
import { FOUND_VIA, type FoundVia, type ListKind } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getList, saveList } from "@/lib/lists";
import { newId } from "@/lib/ids";

export async function saveOrder(kind: ListKind, ids: string[]) {
  const user = await requireUser();
  await saveList(user.id, kind, ids);
  refresh();
}

/** Move a song between All-Time and On Deck. It lands at the bottom of the other list. */
export async function moveToList(trackId: string, from: ListKind, to: ListKind) {
  const user = await requireUser();
  const [src, dst] = await Promise.all([getList(user.id, from), getList(user.id, to)]);
  const dstIds = dst.map((e) => e.track.id);
  if (!dstIds.includes(trackId)) await saveList(user.id, to, [...dstIds, trackId]);
  await saveList(
    user.id,
    from,
    src.map((e) => e.track.id).filter((id) => id !== trackId),
  );
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
export async function saveOrigin(input: OriginInput) {
  const user = await requireUser();
  const db = await getDb();
  const foundVia = input.foundVia && FOUND_VIA.includes(input.foundVia) ? input.foundVia : null;
  let fromUserId = foundVia === "friend" ? input.fromUserId || null : null;
  if (fromUserId) {
    const giver = (await db.select().from(schema.users).where(eq(schema.users.id, fromUserId)))[0];
    if (!giver || giver.crewId !== user.crewId || giver.id === user.id) fromUserId = null;
  }
  const fromName = foundVia === "someone" ? input.fromName?.trim() || null : null;
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
