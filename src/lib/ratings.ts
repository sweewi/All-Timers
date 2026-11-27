import "server-only";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { RatingBucket, Track } from "@/db/schema";
import { inGroup } from "./groups";
import { bucketScores, groupChart, isHotTake, needsRenumber, ordBetween, tasteMatch } from "./rating-math";

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** One person's bucket, best first, with the songs. */
export async function getBucket(userId: string, bucket: RatingBucket) {
  const db = await getDb();
  return db
    .select({ trackId: schema.ratings.trackId, ord: schema.ratings.ord, score: schema.ratings.score, track: schema.tracks })
    .from(schema.ratings)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.ratings.trackId))
    .where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.bucket, bucket)))
    .orderBy(desc(schema.ratings.ord));
}

export async function getRating(userId: string, trackId: string) {
  const db = await getDb();
  return (await db.select().from(schema.ratings).where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.trackId, trackId))))[0] ?? null;
}

/** Re-derive every score in a bucket from its order (renumbering ords if they've got too close). */
async function rescore(tx: Tx, userId: string, bucket: RatingBucket) {
  const rows = await tx
    .select({ trackId: schema.ratings.trackId, ord: schema.ratings.ord })
    .from(schema.ratings)
    .where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.bucket, bucket)))
    .orderBy(desc(schema.ratings.ord));
  const scores = bucketScores(bucket, rows.length);
  const renumber = needsRenumber(rows.map((r) => r.ord));
  for (let i = 0; i < rows.length; i++) {
    await tx
      .update(schema.ratings)
      .set({ score: scores[i], ...(renumber ? { ord: rows.length - i } : {}) })
      .where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.trackId, rows[i].trackId)));
  }
}

export class RatingError extends Error {}

/**
 * Place a song in someone's ranking. `above` is the song that should sit just above it
 * (null: it's the new best), `below` just under it (null: the new worst). Neighbours
 * that aren't in that bucket any more (another tab moved them) are ignored and the
 * song goes next to whichever one is still valid, so a stale page can't corrupt the order.
 */
export async function placeRating(input: {
  userId: string;
  trackId: string;
  bucket: RatingBucket;
  above: string | null;
  below: string | null;
  comparisons: number;
  note?: string | null;
}) {
  const db = await getDb();
  const track = (await db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, input.trackId)))[0];
  if (!track) throw new RatingError("Unknown song.");
  return db.transaction(async (tx) => {
    const prev = (
      await tx.select().from(schema.ratings).where(and(eq(schema.ratings.userId, input.userId), eq(schema.ratings.trackId, input.trackId)))
    )[0];
    if (prev) await tx.delete(schema.ratings).where(and(eq(schema.ratings.userId, input.userId), eq(schema.ratings.trackId, input.trackId)));
    const anchors = [input.above, input.below].filter((x): x is string => !!x && x !== input.trackId);
    const found = anchors.length
      ? await tx
          .select({ trackId: schema.ratings.trackId, ord: schema.ratings.ord })
          .from(schema.ratings)
          .where(and(eq(schema.ratings.userId, input.userId), eq(schema.ratings.bucket, input.bucket), inArray(schema.ratings.trackId, anchors)))
      : [];
    const ordOf = new Map(found.map((f) => [f.trackId, f.ord]));
    let above = input.above ? (ordOf.get(input.above) ?? null) : null;
    let below = input.below ? (ordOf.get(input.below) ?? null) : null;
    if (above != null && below != null && above <= below) below = null; // stale order: trust the song it beat
    if (above == null && below == null && anchors.length) {
      // both anchors gone: put it in the middle of the bucket rather than at an end
      const mid = await tx
        .select({ ord: sql<number>`avg(${schema.ratings.ord})` })
        .from(schema.ratings)
        .where(and(eq(schema.ratings.userId, input.userId), eq(schema.ratings.bucket, input.bucket)));
      above = mid[0]?.ord != null ? Number(mid[0].ord) + 0.5 : null;
      below = mid[0]?.ord != null ? Number(mid[0].ord) - 0.5 : null;
    }
    const ord = ordBetween(above, below);
    const note = input.note === undefined ? (prev?.note ?? null) : input.note?.trim().slice(0, 280) || null;
    await tx.insert(schema.ratings).values({
      userId: input.userId,
      trackId: input.trackId,
      bucket: input.bucket,
      ord,
      score: 0,
      note,
      comparisons: input.comparisons,
      createdAt: prev?.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
    await rescore(tx, input.userId, input.bucket);
    if (prev && prev.bucket !== input.bucket) await rescore(tx, input.userId, prev.bucket);
    const saved = (
      await tx.select().from(schema.ratings).where(and(eq(schema.ratings.userId, input.userId), eq(schema.ratings.trackId, input.trackId)))
    )[0];
    const total = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.ratings).where(eq(schema.ratings.userId, input.userId));
    const rank = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.ratings)
      .where(and(eq(schema.ratings.userId, input.userId), sql`${schema.ratings.score} > ${saved.score}`));
    return { score: saved.score, rank: (rank[0]?.n ?? 0) + 1, total: total[0]?.n ?? 1 };
  });
}

export async function setNote(userId: string, trackId: string, note: string) {
  const db = await getDb();
  await db
    .update(schema.ratings)
    .set({ note: note.trim().slice(0, 280) || null, updatedAt: new Date() })
    .where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.trackId, trackId)));
}

export async function removeRating(userId: string, trackId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const prev = (await tx.select().from(schema.ratings).where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.trackId, trackId))))[0];
    if (!prev) return;
    await tx.delete(schema.ratings).where(and(eq(schema.ratings.userId, userId), eq(schema.ratings.trackId, trackId)));
    await rescore(tx, userId, prev.bucket);
  });
}

/** Everyone's ratings in this group for these songs: trackId → [{user, score, note}]. */
export async function groupRatingsFor(crewId: string, trackIds: string[]) {
  const out = new Map<string, { userId: string; name: string; color: string; handle: string; score: number; note: string | null }[]>();
  if (!trackIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ r: schema.ratings, u: { id: schema.users.id, name: schema.users.name, color: schema.users.color, handle: schema.users.handle } })
    .from(schema.ratings)
    .innerJoin(schema.users, eq(schema.users.id, schema.ratings.userId))
    .where(and(inArray(schema.ratings.trackId, [...new Set(trackIds)]), inGroup(crewId)))
    .orderBy(desc(schema.ratings.score));
  for (const { r, u } of rows) {
    out.set(r.trackId, [...(out.get(r.trackId) ?? []), { userId: u.id, name: u.name, color: u.color, handle: u.handle, score: r.score, note: r.note }]);
  }
  return out;
}

/** The group's latest ratings, newest first, each marked if it's a hot take. */
export async function freshTakes(crewId: string, limit = 12) {
  const db = await getDb();
  const rows = await db
    .select({ r: schema.ratings, track: schema.tracks, u: { id: schema.users.id, name: schema.users.name, color: schema.users.color, handle: schema.users.handle } })
    .from(schema.ratings)
    .innerJoin(schema.users, eq(schema.users.id, schema.ratings.userId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.ratings.trackId))
    .where(inGroup(crewId))
    .orderBy(desc(schema.ratings.updatedAt))
    .limit(limit);
  const others = await groupRatingsFor(crewId, rows.map((r) => r.r.trackId));
  return rows.map(({ r, track, u }) => {
    const rest = (others.get(r.trackId) ?? []).filter((o) => o.userId !== u.id);
    return { user: u, track, score: r.score, bucket: r.bucket, note: r.note, at: r.updatedAt, others: rest, hot: isHotTake(r.score, rest.map((o) => o.score)) };
  });
}

/** The group chart: songs by Bayesian-averaged score across members. */
export async function groupTop(crewId: string, limit = 25) {
  const db = await getDb();
  const rows = await db
    .select({ trackId: schema.ratings.trackId, score: schema.ratings.score })
    .from(schema.ratings)
    .where(sql`${schema.ratings.userId} in (select ${schema.memberships.userId} from ${schema.memberships} where ${schema.memberships.crewId} = ${crewId})`);
  const chart = groupChart(rows).slice(0, limit);
  if (!chart.length) return [];
  const tracks = await db.select().from(schema.tracks).where(inArray(schema.tracks.id, chart.map((c) => c.trackId)));
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return chart.filter((c) => byId.has(c.trackId)).map((c) => ({ ...c, track: byId.get(c.trackId)! }));
}

/** How alike this person's taste is to each other member's (needs 3+ songs both rated). */
export async function tasteMatches(userId: string, crewId: string) {
  const db = await getDb();
  const rows = await db
    .select({ userId: schema.ratings.userId, trackId: schema.ratings.trackId, score: schema.ratings.score })
    .from(schema.ratings)
    .where(sql`${schema.ratings.userId} in (select ${schema.memberships.userId} from ${schema.memberships} where ${schema.memberships.crewId} = ${crewId})`);
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!by.has(r.userId)) by.set(r.userId, new Map());
    by.get(r.userId)!.set(r.trackId, r.score);
  }
  const mine = by.get(userId) ?? new Map<string, number>();
  const out = new Map<string, { match: number | null; shared: number }>();
  for (const [other, theirs] of by) if (other !== userId) out.set(other, tasteMatch(mine, theirs));
  return out;
}

/** Songs worth rating next: this month's pool, friends' columns, then their own lists. Unrated only. */
export async function rateQueue(userId: string, crewId: string, limit = 12) {
  const db = await getDb();
  const rated = new Set((await db.select({ t: schema.ratings.trackId }).from(schema.ratings).where(eq(schema.ratings.userId, userId))).map((r) => r.t));
  const picks: { track: Track; why: string }[] = [];
  const seen = new Set<string>();
  const push = (track: Track, why: string) => {
    if (rated.has(track.id) || seen.has(track.id) || !track.name) return;
    seen.add(track.id);
    picks.push({ track, why });
  };
  const pool = await db
    .select({ track: schema.tracks })
    .from(schema.monthlyPool)
    .innerJoin(schema.monthlyRounds, eq(schema.monthlyRounds.id, schema.monthlyPool.roundId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.monthlyPool.trackId))
    .where(and(eq(schema.monthlyRounds.crewId, crewId), eq(schema.monthlyRounds.status, "open")))
    .limit(30);
  for (const p of pool) push(p.track, "in this month's pool");
  const friends = await db
    .select({ track: schema.tracks, name: schema.users.name, position: schema.listEntries.position })
    .from(schema.listEntries)
    .innerJoin(schema.users, eq(schema.users.id, schema.listEntries.userId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
    .where(and(eq(schema.listEntries.kind, "all_time"), ne(schema.listEntries.userId, userId), inGroup(crewId)))
    .orderBy(schema.listEntries.position)
    .limit(120);
  for (const f of friends) push(f.track, `${f.name}'s #${f.position}`);
  const own = await db
    .select({ track: schema.tracks, kind: schema.listEntries.kind })
    .from(schema.listEntries)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
    .where(eq(schema.listEntries.userId, userId))
    .limit(150);
  for (const o of own) push(o.track, o.kind === "on_deck" ? "on deck" : "on your column");
  // interleave sources so the queue isn't 12 songs from one place
  return picks.slice(0, limit * 3).sort((a, b) => hash(a.track.id) - hash(b.track.id)).slice(0, limit);
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

/** Search the songs the site already knows (everyone's lists, pools, listening). */
export async function searchKnownTracks(q: string, limit = 12) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const db = await getDb();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select()
    .from(schema.tracks)
    .where(and(or(ilike(schema.tracks.name, like), ilike(schema.tracks.artists, like)), sql`${schema.tracks.imageUrl} is not null`))
    .limit(limit);
}

/** Someone's whole ranking across buckets, best first. */
export async function myRanking(userId: string) {
  const db = await getDb();
  return db
    .select({ r: schema.ratings, track: schema.tracks })
    .from(schema.ratings)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.ratings.trackId))
    .where(eq(schema.ratings.userId, userId))
    .orderBy(desc(schema.ratings.score), desc(schema.ratings.ord));
}
