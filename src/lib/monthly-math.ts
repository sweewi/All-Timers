/**
 * The arithmetic of a monthly list, kept free of the database so it can be tested.
 */

export type MonthPick = { trackId: string; rank: number; streams: number };
export type PoolEntry = { trackId: string; weight: number; detail: { userId: string; rank: number; streams: number }[] };

/**
 * Everyone's month, weighted so each person counts the same no matter how much they
 * listen: each person brings their top `perPerson` songs, worth 1.0 for their #1
 * down to 1/perPerson for the last. A song several people played gets their weights
 * added up. Sorted by weight, capped at `max`.
 */
export function buildPool(perUser: Map<string, MonthPick[]>, perPerson = 5, max = 30): PoolEntry[] {
  const pool = new Map<string, PoolEntry>();
  for (const [userId, picks] of perUser) {
    const top = [...picks].sort((a, b) => a.rank - b.rank).slice(0, perPerson);
    top.forEach((p, i) => {
      const e = pool.get(p.trackId) ?? { trackId: p.trackId, weight: 0, detail: [] };
      e.weight += (perPerson - i) / perPerson;
      e.detail.push({ userId, rank: i + 1, streams: p.streams });
      pool.set(p.trackId, e);
    });
  }
  return [...pool.values()]
    .sort((a, b) => b.weight - a.weight || b.detail.length - a.detail.length || a.trackId.localeCompare(b.trackId))
    .slice(0, max);
}

export type Result = { trackId: string; position: number; score: number; voters: number; firsts: number };

/**
 * Rank the pool from everyone's ballots with an averaged Borda count.
 * On a ballot of n songs, #1 earns 1.0 and #n earns 1/n; songs a voter left off
 * earn 0. A song's score is its average over all voters, so a song only one person
 * ranked can't beat a song everyone liked. Ties: more first places, then more voters
 * who ranked it, then the pool order.
 */
export function tally(ballots: Map<string, string[]>, poolOrder: string[]): Result[] {
  const voters = [...ballots.values()].filter((b) => b.length > 0);
  const inPool = new Set(poolOrder);
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  const firsts = new Map<string, number>();
  for (const ballot of voters) {
    const clean = ballot.filter((id, i) => inPool.has(id) && ballot.indexOf(id) === i);
    const n = clean.length;
    clean.forEach((id, i) => {
      sum.set(id, (sum.get(id) ?? 0) + (n - i) / n);
      count.set(id, (count.get(id) ?? 0) + 1);
      if (i === 0) firsts.set(id, (firsts.get(id) ?? 0) + 1);
    });
  }
  const V = Math.max(1, voters.length);
  const idx = new Map(poolOrder.map((id, i) => [id, i]));
  return poolOrder
    .map((trackId) => ({ trackId, score: (sum.get(trackId) ?? 0) / V, voters: count.get(trackId) ?? 0, firsts: firsts.get(trackId) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.firsts - a.firsts || b.voters - a.voters || idx.get(a.trackId)! - idx.get(b.trackId)!)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/** When a month is revealed: 8pm on its last day, in the app's timezone (given as an offset fn). */
export function revealAt(monthEndMs: number, hourLocal = 20) {
  // monthEndMs is local midnight starting the next month; 4 hours earlier is 8pm on the last day
  return monthEndMs - (24 - hourLocal) * 3_600_000;
}
