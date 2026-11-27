import type { RatingBucket } from "@/db/schema";

/**
 * The maths behind ratings. Pure, so it's shared by the server, the rating flow in the
 * browser, and the tests.
 *
 * A person sorts every song they rate into a gut bucket, then head-to-heads place it
 * within that bucket. Scores come from position: each bucket owns a band of the 0–10
 * scale and its songs are spread evenly across it, best first.
 */

export const BANDS: Record<RatingBucket, { lo: number; hi: number; label: string; ask: string }> = {
  loved: { lo: 6.7, hi: 10, label: "Loved it", ask: "Which one do you love more?" },
  fine: { lo: 3.4, hi: 6.7, label: "It was fine", ask: "Which one's better?" },
  disliked: { lo: 0, hi: 3.4, label: "Not for me", ask: "Which one's less bad?" },
};

/**
 * Score of the song at `index` (0 = best) in a bucket of `n` songs. Evenly spread inside
 * the band, never touching its edges: a lone loved song is 8.4, and a bucket's best
 * creeps toward 10 as the bucket grows (it has to beat more songs to get there).
 */
export function scoreAt(bucket: RatingBucket, index: number, n: number) {
  const { lo, hi } = BANDS[bucket];
  if (n <= 0) return round1((lo + hi) / 2);
  const i = Math.min(Math.max(0, index), n - 1);
  return round1(lo + ((hi - lo) * (n - i)) / (n + 1));
}

/** Scores for a whole bucket listed best first. */
export function bucketScores(bucket: RatingBucket, n: number) {
  return Array.from({ length: n }, (_, i) => scoreAt(bucket, i, n));
}

export const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * An `ord` for a song placed between two neighbours (higher ord = better). `above` is the
 * ord of the song just better than it (null if it's the new best), `below` the one just
 * worse (null if it's the new worst).
 */
export function ordBetween(above: number | null, below: number | null) {
  if (above == null && below == null) return 0;
  if (above == null) return below! + 1;
  if (below == null) return above - 1;
  return (above + below) / 2;
}

/** True when neighbouring ords are too close for another midpoint: time to renumber. */
export function needsRenumber(ords: number[]) {
  for (let i = 1; i < ords.length; i++) if (Math.abs(ords[i - 1] - ords[i]) < 1e-9) return true;
  return false;
}

/**
 * The head-to-head search: a binary insertion over the bucket (best first). Each step
 * names the song to compare against; the answer narrows the range. About log2(n)
 * questions: 5 for 30 songs, 7 for 100.
 */
export type Search = { lo: number; hi: number; asked: number };
export const startSearch = (n: number): Search => ({ lo: 0, hi: n, asked: 0 });
export const searchDone = (s: Search) => s.lo >= s.hi;
export const searchMid = (s: Search) => (s.lo + s.hi) >> 1;
/** `newIsBetter`: the new song beat the one at searchMid. */
export function searchStep(s: Search, newIsBetter: boolean): Search {
  const mid = searchMid(s);
  return newIsBetter ? { lo: s.lo, hi: mid, asked: s.asked + 1 } : { lo: mid + 1, hi: s.hi, asked: s.asked + 1 };
}
/** "Too close to call": settle right next to the song it was compared with. */
export function searchTie(s: Search): Search {
  const mid = searchMid(s);
  return { lo: mid, hi: mid, asked: s.asked + 1 };
}
/** Most questions this bucket can take: ceil(log2(n+1)). */
export const maxQuestions = (n: number) => (n <= 0 ? 0 : Math.ceil(Math.log2(n + 1)));

/**
 * How alike two people's taste is, from songs both have rated: Pearson correlation of
 * their scores mapped to 0–100%. Null with fewer than 3 shared songs (too little to say).
 */
export function tasteMatch(a: Map<string, number>, b: Map<string, number>) {
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length < 3) return { match: null as number | null, shared: shared.length };
  const xs = shared.map((k) => a.get(k)!);
  const ys = shared.map((k) => b.get(k)!);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  // nobody varied: agreement is judged by how close the scores are instead
  if (dx === 0 || dy === 0) {
    const gap = mean(xs.map((x, i) => Math.abs(x - ys[i])));
    return { match: Math.round(Math.max(0, 100 - gap * 10)), shared: shared.length };
  }
  const r = num / Math.sqrt(dx * dy);
  return { match: Math.round(((r + 1) / 2) * 100), shared: shared.length };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Group chart: each song's average score, pulled toward the group's overall average
 * until enough people have rated it (a Bayesian average). One 10 doesn't top the chart;
 * five people's 9s do.
 */
export function groupChart(rows: { trackId: string; score: number }[], prior = 2) {
  if (!rows.length) return [];
  const overall = mean(rows.map((r) => r.score));
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.trackId, [...(by.get(r.trackId) ?? []), r.score]);
  return [...by.entries()]
    .map(([trackId, scores]) => ({
      trackId,
      raters: scores.length,
      average: round1(mean(scores)),
      weighted: (prior * overall + scores.reduce((s, x) => s + x, 0)) / (prior + scores.length),
    }))
    .sort((x, y) => y.weighted - x.weighted || y.raters - x.raters || x.trackId.localeCompare(y.trackId));
}

/** A rating far from the group's (3+ points off the others' average, with 2+ others) is a hot take. */
export function isHotTake(score: number, others: number[]) {
  return others.length >= 2 && Math.abs(score - mean(others)) >= 3;
}
