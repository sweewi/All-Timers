import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MonthlyRound, Track } from "@/db/schema";
import { newId } from "./ids";
import { fetchMonth, getAccounts, monthKeyOf, monthWindow, visibility } from "./listening";
import { buildPool, revealAt, tally, type MonthPick } from "./monthly-math";

export const NOMINATIONS_PER_PERSON = 3;
export const PICKS_PER_PERSON = 5;
export const POOL_MAX = 30;

export function phaseOf(round: Pick<MonthlyRound, "month" | "status">, now = Date.now()) {
  const { before } = monthWindow(round.month);
  const reveal = revealAt(before);
  if (round.status === "revealed") return { phase: "revealed" as const, reveal };
  if (now >= reveal) return { phase: "due" as const, reveal };
  return { phase: "open" as const, reveal };
}

/** The round for this crew and month, created on first sight. */
export async function ensureRound(crewId: string, month = monthKeyOf()): Promise<MonthlyRound> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("bad month");
  const db = await getDb();
  await db.insert(schema.monthlyRounds).values({ id: newId(), crewId, month }).onConflictDoNothing();
  const row = (await db.select().from(schema.monthlyRounds).where(and(eq(schema.monthlyRounds.crewId, crewId), eq(schema.monthlyRounds.month, month))))[0];
  return row;
}

export async function getRound(crewId: string, month: string) {
  const db = await getDb();
  return (await db.select().from(schema.monthlyRounds).where(and(eq(schema.monthlyRounds.crewId, crewId), eq(schema.monthlyRounds.month, month))))[0] ?? null;
}

export async function pastRounds(crewId: string) {
  const db = await getDb();
  return db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.crewId, crewId)).orderBy(sql`${schema.monthlyRounds.month} desc`);
}

/**
 * Grow the pool from what members actually played this month. Songs only ever join
 * (never leave) while the round is open, so nobody's ballot loses a song mid-month.
 */
export async function refreshPool(round: MonthlyRound) {
  if (round.status !== "open") return;
  const db = await getDb();
  const members = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.crewId, round.crewId));
  const accts = await getAccounts(members.map((m) => m.id));
  const perUser = new Map<string, MonthPick[]>();
  for (const [userId, a] of accts) {
    if (!visibility(a).tops) continue;
    await fetchMonth(userId, round.month);
    const rows = await db
      .select({ trackId: schema.listenTops.trackId, rank: schema.listenTops.position, streams: schema.listenTops.streams })
      .from(schema.listenTops)
      .where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.period, `m:${round.month}`)))
      .orderBy(asc(schema.listenTops.position))
      .limit(PICKS_PER_PERSON);
    if (rows.length) perUser.set(userId, rows);
  }
  const pool = buildPool(perUser, PICKS_PER_PERSON, POOL_MAX);
  if (!pool.length) {
    await db.update(schema.monthlyRounds).set({ poolBuiltAt: new Date() }).where(eq(schema.monthlyRounds.id, round.id));
    return;
  }
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(schema.monthlyPool).where(eq(schema.monthlyPool.roundId, round.id));
    const have = new Map(existing.map((e) => [e.trackId, e]));
    const room = Math.max(0, POOL_MAX - existing.length);
    let added = 0;
    for (const p of pool) {
      const cur = have.get(p.trackId);
      if (cur) {
        if (cur.source === "plays" || p.weight > cur.weight) {
          await tx
            .update(schema.monthlyPool)
            .set({ weight: Math.max(cur.weight, p.weight), detail: JSON.stringify(p.detail) })
            .where(and(eq(schema.monthlyPool.roundId, round.id), eq(schema.monthlyPool.trackId, p.trackId)));
        }
      } else if (added < room) {
        await tx.insert(schema.monthlyPool).values({ roundId: round.id, trackId: p.trackId, source: "plays", detail: JSON.stringify(p.detail), weight: p.weight });
        added++;
      }
    }
    await tx.update(schema.monthlyRounds).set({ poolBuiltAt: new Date() }).where(eq(schema.monthlyRounds.id, round.id));
  });
}

export type PoolSong = {
  track: Track;
  source: "plays" | "nomination";
  nominatedBy: string | null;
  weight: number;
  detail: { userId: string; rank: number; streams: number }[];
};

export async function getPool(roundId: string): Promise<PoolSong[]> {
  const db = await getDb();
  const rows = await db
    .select({ p: schema.monthlyPool, track: schema.tracks })
    .from(schema.monthlyPool)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.monthlyPool.trackId))
    .where(eq(schema.monthlyPool.roundId, roundId));
  return rows
    .map(({ p, track }) => {
      let detail: PoolSong["detail"] = [];
      try {
        detail = JSON.parse(p.detail);
      } catch {}
      return { track, source: p.source, nominatedBy: p.nominatedBy, weight: p.weight, detail };
    })
    .sort((a, b) => b.weight - a.weight || a.track.name.localeCompare(b.track.name));
}

export class MonthlyError extends Error {}

export async function nominate(round: MonthlyRound, userId: string, trackId: string) {
  if (phaseOf(round).phase !== "open") throw new MonthlyError("This month is closed.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    const mine = await tx
      .select({ trackId: schema.monthlyPool.trackId })
      .from(schema.monthlyPool)
      .where(and(eq(schema.monthlyPool.roundId, round.id), eq(schema.monthlyPool.nominatedBy, userId)));
    if (mine.length >= NOMINATIONS_PER_PERSON) throw new MonthlyError(`You've used your ${NOMINATIONS_PER_PERSON} nominations this month.`);
    const count = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.monthlyPool).where(eq(schema.monthlyPool.roundId, round.id));
    if ((count[0]?.n ?? 0) >= POOL_MAX + 10) throw new MonthlyError("The pool is full this month.");
    const existing = (await tx.select().from(schema.monthlyPool).where(and(eq(schema.monthlyPool.roundId, round.id), eq(schema.monthlyPool.trackId, trackId))))[0];
    if (existing) throw new MonthlyError("That song is already in the pool.");
    await tx.insert(schema.monthlyPool).values({ roundId: round.id, trackId, source: "nomination", nominatedBy: userId, weight: 0.5 });
  });
}

export async function withdrawNomination(round: MonthlyRound, userId: string, trackId: string) {
  if (phaseOf(round).phase !== "open") throw new MonthlyError("This month is closed.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.monthlyPool)
      .where(
        and(
          eq(schema.monthlyPool.roundId, round.id),
          eq(schema.monthlyPool.trackId, trackId),
          eq(schema.monthlyPool.nominatedBy, userId),
          eq(schema.monthlyPool.source, "nomination"),
        ),
      );
    // it can't stay on anyone's ballot if it's no longer in the pool
    const still = await tx.select().from(schema.monthlyPool).where(and(eq(schema.monthlyPool.roundId, round.id), eq(schema.monthlyPool.trackId, trackId)));
    if (!still.length) await tx.delete(schema.monthlyBallots).where(and(eq(schema.monthlyBallots.roundId, round.id), eq(schema.monthlyBallots.trackId, trackId)));
  });
}

export async function getBallot(roundId: string, userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ trackId: schema.monthlyBallots.trackId })
    .from(schema.monthlyBallots)
    .where(and(eq(schema.monthlyBallots.roundId, roundId), eq(schema.monthlyBallots.userId, userId)))
    .orderBy(asc(schema.monthlyBallots.position));
  return rows.map((r) => r.trackId);
}

/** Who has voted (not how). */
export async function votersOf(roundId: string) {
  const db = await getDb();
  const rows = await db.selectDistinct({ userId: schema.monthlyBallots.userId }).from(schema.monthlyBallots).where(eq(schema.monthlyBallots.roundId, roundId));
  return new Set(rows.map((r) => r.userId));
}

export async function saveBallot(round: MonthlyRound, userId: string, order: string[]) {
  if (phaseOf(round).phase !== "open") throw new MonthlyError("Voting has closed for this month.");
  const db = await getDb();
  const pool = await db.select({ trackId: schema.monthlyPool.trackId }).from(schema.monthlyPool).where(eq(schema.monthlyPool.roundId, round.id));
  const allowed = new Set(pool.map((p) => p.trackId));
  const clean = [...new Set(order)].filter((id) => allowed.has(id));
  await db.transaction(async (tx) => {
    await tx.delete(schema.monthlyBallots).where(and(eq(schema.monthlyBallots.roundId, round.id), eq(schema.monthlyBallots.userId, userId)));
    if (clean.length) {
      await tx.insert(schema.monthlyBallots).values(clean.map((trackId, i) => ({ roundId: round.id, userId, trackId, position: i + 1 })));
    }
  });
  return clean.length;
}

/** Freeze the group ranking. Safe to call repeatedly; only the first call does anything. */
export async function revealIfDue(round: MonthlyRound) {
  if (phaseOf(round).phase !== "due") return round;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const lock = await tx
      .update(schema.monthlyRounds)
      .set({ status: "revealed", revealedAt: new Date() })
      .where(and(eq(schema.monthlyRounds.id, round.id), eq(schema.monthlyRounds.status, "open")))
      .returning({ id: schema.monthlyRounds.id });
    if (!lock.length) return; // someone else revealed it first
    const pool = await tx.select().from(schema.monthlyPool).where(eq(schema.monthlyPool.roundId, round.id));
    const order = [...pool].sort((a, b) => b.weight - a.weight || a.trackId.localeCompare(b.trackId)).map((p) => p.trackId);
    const ballots = await tx.select().from(schema.monthlyBallots).where(eq(schema.monthlyBallots.roundId, round.id)).orderBy(asc(schema.monthlyBallots.position));
    const byUser = new Map<string, string[]>();
    for (const b of ballots) byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b.trackId]);
    const results = tally(byUser, order);
    if (results.length) {
      await tx.insert(schema.monthlyResults).values(results.map((r) => ({ roundId: round.id, trackId: r.trackId, position: r.position, score: r.score, voters: r.voters })));
    }
  });
  return (await db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.id, round.id)))[0];
}

export async function getResults(roundId: string) {
  const db = await getDb();
  return db
    .select({ position: schema.monthlyResults.position, score: schema.monthlyResults.score, voters: schema.monthlyResults.voters, track: schema.tracks })
    .from(schema.monthlyResults)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.monthlyResults.trackId))
    .where(eq(schema.monthlyResults.roundId, roundId))
    .orderBy(asc(schema.monthlyResults.position));
}

/** Everyone's #1 for a revealed round (ballots are shown after the reveal). */
export async function firstPicks(roundId: string) {
  const db = await getDb();
  return db
    .select({ userId: schema.monthlyBallots.userId, trackId: schema.monthlyBallots.trackId })
    .from(schema.monthlyBallots)
    .where(and(eq(schema.monthlyBallots.roundId, roundId), eq(schema.monthlyBallots.position, 1)));
}

export async function poolTrackIds(roundId: string) {
  const db = await getDb();
  const rows = await db.select({ trackId: schema.monthlyPool.trackId }).from(schema.monthlyPool).where(eq(schema.monthlyPool.roundId, roundId));
  return rows.map((r) => r.trackId);
}

export { inArray };
