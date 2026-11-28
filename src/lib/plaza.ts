import "server-only";
import { and, desc, eq, gte, isNotNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Track, User } from "@/db/schema";
import { inGroup } from "./groups";

/**
 * What the plaza talks about. Lists barely change once they're made, so the news is
 * the big moments (a list set in stone, a song added to one, someone new) and the
 * whys behind the songs, not every reorder.
 */

type Person = Pick<User, "id" | "name" | "handle" | "color">;
const person = { id: schema.users.id, name: schema.users.name, handle: schema.users.handle, color: schema.users.color };

export type NewsItem =
  | { type: "stone"; at: Date; user: Person; count: number; top: Track | null }
  | { type: "added"; at: Date; user: Person; tracks: { track: Track; pos: number }[]; afterStone: boolean; batchId: string }
  | { type: "joined"; at: Date; user: Person };

export async function getNews(crewId: string, limit = 12): Promise<NewsItem[]> {
  const db = await getDb();
  const since = new Date(Date.now() - 120 * 86_400_000);
  const [stones, adds, joins, counts] = await Promise.all([
    db
      .select({ user: person, setAt: schema.listProfiles.setAt })
      .from(schema.listProfiles)
      .innerJoin(schema.users, eq(schema.users.id, schema.listProfiles.userId))
      .where(and(inGroup(crewId), isNotNull(schema.listProfiles.setAt), gte(schema.listProfiles.setAt, since))),
    db
      .select({
        user: person,
        batchId: schema.rankEvents.batchId,
        pos: schema.rankEvents.toPos,
        at: schema.rankEvents.createdAt,
        track: schema.tracks,
        setAt: schema.listProfiles.setAt,
      })
      .from(schema.rankEvents)
      .innerJoin(schema.users, eq(schema.users.id, schema.rankEvents.userId))
      .innerJoin(schema.tracks, eq(schema.tracks.id, schema.rankEvents.trackId))
      .leftJoin(schema.listProfiles, eq(schema.listProfiles.userId, schema.rankEvents.userId))
      .where(and(inGroup(crewId), eq(schema.rankEvents.kind, "all_time"), eq(schema.rankEvents.type, "add"), gte(schema.rankEvents.createdAt, since)))
      .orderBy(desc(schema.rankEvents.createdAt))
      .limit(300),
    db
      .select({ user: person, at: schema.memberships.joinedAt })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.crewId, crewId), gte(schema.memberships.joinedAt, since))),
    db
      .select({ userId: schema.listEntries.userId, position: schema.listEntries.position, track: schema.tracks })
      .from(schema.listEntries)
      .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
      .innerJoin(schema.users, eq(schema.users.id, schema.listEntries.userId))
      .where(and(inGroup(crewId), eq(schema.listEntries.kind, "all_time"))),
  ]);

  const listOf = (userId: string) => counts.filter((c) => c.userId === userId);
  const items: NewsItem[] = [];
  for (const s of stones) {
    const list = listOf(s.user.id);
    items.push({ type: "stone", at: s.setAt!, user: s.user, count: list.length, top: list.find((e) => e.position === 1)?.track ?? null });
  }
  const batches = new Map<string, Extract<NewsItem, { type: "added" }>>();
  for (const a of adds) {
    let b = batches.get(a.batchId);
    if (!b) {
      b = { type: "added", at: a.at, user: a.user, tracks: [], afterStone: !!a.setAt && a.at > a.setAt, batchId: a.batchId };
      batches.set(a.batchId, b);
    }
    b.tracks.push({ track: a.track, pos: a.pos ?? 0 });
  }
  for (const b of batches.values()) {
    b.tracks.sort((x, y) => x.pos - y.pos);
    items.push(b);
  }
  for (const j of joins) items.push({ type: "joined", at: j.at, user: j.user });
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type Why = {
  user: Person;
  track: Track;
  rank: number;
  love: string | null;
  moment: string | null;
  story: string | null;
  from: Person | null;
  at: Date;
};

/** The newest whys in the group: songs still on someone's list, with something written about them. */
export async function recentWhys(crewId: string, limit = 12): Promise<Why[]> {
  const db = await getDb();
  const rows = await db
    .select({
      user: person,
      track: schema.tracks,
      rank: schema.listEntries.position,
      love: schema.origins.love,
      moment: schema.origins.moment,
      story: schema.origins.story,
      fromUserId: schema.origins.fromUserId,
      at: schema.origins.updatedAt,
    })
    .from(schema.origins)
    .innerJoin(schema.users, eq(schema.users.id, schema.origins.userId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.origins.trackId))
    .innerJoin(
      schema.listEntries,
      and(
        eq(schema.listEntries.userId, schema.origins.userId),
        eq(schema.listEntries.trackId, schema.origins.trackId),
        eq(schema.listEntries.kind, "all_time"),
      ),
    )
    .where(and(inGroup(crewId), or(isNotNull(schema.origins.love), isNotNull(schema.origins.story))))
    .orderBy(desc(schema.origins.updatedAt))
    .limit(limit);
  const fromIds = [...new Set(rows.map((r) => r.fromUserId).filter(Boolean))] as string[];
  const froms = fromIds.length
    ? await db.select(person).from(schema.users).where(or(...fromIds.map((id) => eq(schema.users.id, id))))
    : [];
  const fromMap = new Map(froms.map((f) => [f.id, f]));
  return rows.map((r) => ({
    user: r.user,
    track: r.track,
    rank: r.rank,
    love: r.love,
    moment: r.moment,
    story: r.story,
    from: r.fromUserId ? (fromMap.get(r.fromUserId) ?? null) : null,
    at: r.at,
  }));
}
