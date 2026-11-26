import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import type { ListKind, Origin, Track, User } from "@/db/schema";
import { newId } from "./ids";

export type Entry = {
  position: number;
  addedAt: Date;
  track: Track;
  origin: (Origin & { fromUser: Pick<User, "id" | "name" | "handle" | "color"> | null }) | null;
};

const fromUsers = alias(schema.users, "from_users");

export async function getList(userId: string, kind: ListKind): Promise<Entry[]> {
  const db = await getDb();
  const rows = await db
    .select({
      position: schema.listEntries.position,
      addedAt: schema.listEntries.addedAt,
      track: schema.tracks,
      origin: schema.origins,
      fromUser: { id: fromUsers.id, name: fromUsers.name, handle: fromUsers.handle, color: fromUsers.color },
    })
    .from(schema.listEntries)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
    .leftJoin(
      schema.origins,
      and(eq(schema.origins.userId, schema.listEntries.userId), eq(schema.origins.trackId, schema.listEntries.trackId)),
    )
    .leftJoin(fromUsers, eq(fromUsers.id, schema.origins.fromUserId))
    .where(and(eq(schema.listEntries.userId, userId), eq(schema.listEntries.kind, kind)))
    .orderBy(asc(schema.listEntries.position));

  return rows.map((r) => ({
    position: r.position,
    addedAt: r.addedAt,
    track: r.track,
    origin: r.origin ? { ...r.origin, fromUser: r.fromUser?.id ? r.fromUser : null } : null,
  }));
}

/**
 * Replace a list with this exact order and log what changed (adds, removes, moves)
 * as one batch, so the feed can say "Sam moved X from #7 to #3".
 */
export async function saveList(userId: string, kind: ListKind, trackIds: string[]) {
  const db = await getDb();
  const current = await db
    .select({ trackId: schema.listEntries.trackId, position: schema.listEntries.position })
    .from(schema.listEntries)
    .where(and(eq(schema.listEntries.userId, userId), eq(schema.listEntries.kind, kind)));
  const before = new Map(current.map((e) => [e.trackId, e.position]));
  const unique = [...new Set(trackIds)];
  const after = new Map(unique.map((id, i) => [id, i + 1]));
  const batchId = newId();
  const events: (typeof schema.rankEvents.$inferInsert)[] = [];

  for (const [trackId, pos] of after) {
    const old = before.get(trackId);
    if (old === undefined) events.push({ id: newId(), batchId, userId, kind, trackId, type: "add", toPos: pos });
    else if (old !== pos) events.push({ id: newId(), batchId, userId, kind, trackId, type: "move", fromPos: old, toPos: pos });
  }
  for (const [trackId, pos] of before) {
    if (!after.has(trackId)) events.push({ id: newId(), batchId, userId, kind, trackId, type: "remove", fromPos: pos });
  }
  if (events.length === 0) return { changed: false };

  await db.transaction(async (tx) => {
    const removed = [...before.keys()].filter((id) => !after.has(id));
    if (removed.length) {
      await tx
        .delete(schema.listEntries)
        .where(
          and(
            eq(schema.listEntries.userId, userId),
            eq(schema.listEntries.kind, kind),
            inArray(schema.listEntries.trackId, removed),
          ),
        );
    }
    for (const [trackId, position] of after) {
      if (before.get(trackId) === position) continue;
      await tx
        .insert(schema.listEntries)
        .values({ userId, kind, trackId, position })
        .onConflictDoUpdate({
          target: [schema.listEntries.userId, schema.listEntries.kind, schema.listEntries.trackId],
          set: { position },
        });
    }
    await tx.insert(schema.rankEvents).values(events);
  });
  return { changed: true };
}

export async function getCrewMembers(crewId: string) {
  const db = await getDb();
  return db.select().from(schema.users).where(eq(schema.users.crewId, crewId)).orderBy(asc(schema.users.createdAt));
}

/** Each member's list length and #1 song, for the crew home page. */
export async function getCrewOverview(crewId: string) {
  const db = await getDb();
  const members = await getCrewMembers(crewId);
  if (members.length === 0) return [];
  const ids = members.map((m) => m.id);
  const entries = await db
    .select({ userId: schema.listEntries.userId, position: schema.listEntries.position, track: schema.tracks })
    .from(schema.listEntries)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
    .where(and(inArray(schema.listEntries.userId, ids), eq(schema.listEntries.kind, "all_time")))
    .orderBy(asc(schema.listEntries.position));
  return members.map((m) => {
    const mine = entries.filter((e) => e.userId === m.id);
    return { member: m, count: mine.length, top: mine.slice(0, 3).map((e) => e.track) };
  });
}

export type FeedItem = {
  batchId: string;
  user: Pick<User, "id" | "name" | "handle" | "color">;
  kind: ListKind;
  createdAt: Date;
  events: { type: "add" | "remove" | "move"; fromPos: number | null; toPos: number | null; track: Track }[];
};

export async function getCrewFeed(crewId: string, limit = 25): Promise<FeedItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      batchId: schema.rankEvents.batchId,
      kind: schema.rankEvents.kind,
      type: schema.rankEvents.type,
      fromPos: schema.rankEvents.fromPos,
      toPos: schema.rankEvents.toPos,
      createdAt: schema.rankEvents.createdAt,
      user: { id: schema.users.id, name: schema.users.name, handle: schema.users.handle, color: schema.users.color },
      track: schema.tracks,
    })
    .from(schema.rankEvents)
    .innerJoin(schema.users, eq(schema.users.id, schema.rankEvents.userId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.rankEvents.trackId))
    .where(eq(schema.users.crewId, crewId))
    .orderBy(desc(schema.rankEvents.createdAt))
    .limit(400);

  const batches = new Map<string, FeedItem>();
  for (const r of rows) {
    let b = batches.get(r.batchId);
    if (!b) {
      if (batches.size >= limit) continue;
      b = { batchId: r.batchId, user: r.user, kind: r.kind, createdAt: r.createdAt, events: [] };
      batches.set(r.batchId, b);
    }
    b.events.push({ type: r.type, fromPos: r.fromPos, toPos: r.toPos, track: r.track });
  }
  for (const b of batches.values()) b.events.sort((a, c) => (a.toPos ?? 999) - (c.toPos ?? 999));
  return [...batches.values()];
}
