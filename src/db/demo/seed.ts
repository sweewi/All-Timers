/**
 * Demo data for the preview sandbox: six members with real songs, stories, reactions
 * and ratings, so every page has something on it. Deterministic (same data on every
 * cold start) and only ever written into the throwaway embedded database.
 */
import { songKey } from "@/lib/songs";
import { bucketScores } from "@/lib/rating-math";
import type { RatingBucket } from "../schema";
import * as schema from "../schema";
import fixture from "./fixture.json";

type Fixture = {
  lists: Record<string, string[]>;
  tracks: { id: string; name: string; artists: string; album: string; releaseYear: number | null; imageUrl: string | null; artColor: string | null; durationMs: number | null; songKey: string }[];
};
const data = fixture as Fixture;

export const DEMO_CREW_ID = "demo-crew";
export const DEMO_PEOPLE = [
  { handle: "will", name: "Will", color: "#d4a13a", admin: true },
  { handle: "sam", name: "Sam", color: "#5b8def", admin: true },
  { handle: "ava", name: "Ava", color: "#c4553b", admin: false },
  { handle: "theo", name: "Theo", color: "#4f9a6b", admin: false },
  { handle: "maya", name: "Maya", color: "#9b6bd1", admin: false },
  { handle: "jonah", name: "Jonah", color: "#d47a9a", admin: false },
] as const;

export const demoUserId = (handle: string) => `demo-user-${handle}`;

/** Small seeded PRNG (mulberry32) so the sandbox looks the same every time. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAKES = [
  "The bridge alone is a 10.",
  "Better every year.",
  "Overplayed, still undeniable.",
  "Grew on me after the third listen.",
  "Production carries it.",
  "Not the hit everyone says.",
  "Perfect 2 a.m. song.",
  "The drums. That's the take.",
];

const STORIES = [
  { foundVia: "friend", love: "That first chorus hits like a wave.", story: "Played it on loop the whole drive back from the coast." },
  { foundVia: "grew_up", love: "Sounds like Saturday mornings.", story: "My parents had this on every road trip." },
  { foundVia: "live", love: "The crowd sang the last verse back.", story: "Saw it live in a tiny room and never recovered." },
  { foundVia: "playlist", love: "The way it builds and never quite breaks.", story: "Snuck up on me in a random playlist at the gym." },
] as const;

type Db = { insert: (t: never) => { values: (v: never) => Promise<unknown> } };

export async function seedDemo(dbIn: unknown) {
  const db = dbIn as Db;
  const ins = <T>(table: T, values: unknown[]) => (values.length ? db.insert(table as never).values(values as never) : Promise.resolve());
  const rand = rng(20261127);
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3600_000);

  await ins(schema.crews, [{ id: DEMO_CREW_ID, name: "The Listening Room", inviteCode: "sandbox-invite" }]);
  await ins(
    schema.users,
    DEMO_PEOPLE.map((p) => ({ id: demoUserId(p.handle), crewId: DEMO_CREW_ID, name: p.name, handle: p.handle, color: p.color, guideSeenAt: new Date(now) })),
  );
  await ins(
    schema.memberships,
    DEMO_PEOPLE.map((p, i) => ({ userId: demoUserId(p.handle), crewId: DEMO_CREW_ID, role: p.admin ? "admin" : "member", joinedAt: ago(24 * 30 - i) })),
  );
  await ins(
    schema.tracks,
    data.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      album: t.album,
      releaseYear: t.releaseYear,
      imageUrl: t.imageUrl,
      durationMs: t.durationMs,
      color: t.artColor,
      songKey: t.songKey || songKey(t.name, JSON.parse(t.artists) as string[]),
      metaSource: "spotify",
    })),
  );

  const lists = Object.entries(data.lists).filter(([h]) => DEMO_PEOPLE.some((p) => p.handle === h));
  const entries = [];
  const events = [];
  for (const [handle, ids] of lists) {
    const userId = demoUserId(handle);
    const batchId = `demo-batch-${handle}`;
    const at = ago(2 + rand() * 72);
    for (const [i, trackId] of ids.entries()) {
      entries.push({ userId, kind: "all_time", trackId, position: i + 1, addedAt: at });
      if (i < 5) events.push({ id: `demo-ev-${handle}-${i}`, batchId, userId, kind: "all_time", trackId, type: "add", toPos: i + 1, createdAt: at });
    }
  }
  await ins(schema.listEntries, entries);
  await ins(schema.rankEvents, events);

  // a story on each person's number one, a put-on between friends
  const origins = lists.map(([handle, ids], i) => {
    const s = STORIES[i % STORIES.length];
    const from = s.foundVia === "friend" ? demoUserId(lists[(i + 1) % lists.length][0]) : null;
    return { id: `demo-origin-${handle}`, userId: demoUserId(handle), trackId: ids[0], fromUserId: from, foundVia: s.foundVia, love: s.love, story: s.story, updatedAt: ago(5 + i) };
  });
  await ins(schema.origins, origins);

  const reactions = [];
  const kinds = ["laurel", "fire", "cry", "same"] as const;
  for (const [owner, ids] of lists)
    for (const [reactor] of lists) {
      if (reactor === owner || rand() < 0.5) continue;
      reactions.push({ id: `demo-react-${reactor}-${owner}`, userId: demoUserId(reactor), target: `song:${demoUserId(owner)}:${ids[0]}`, kind: kinds[Math.floor(rand() * kinds.length)], createdAt: ago(rand() * 48) });
    }
  await ins(schema.reactions, reactions);

  // ratings: everyone rates their own top songs high and samples friends' songs with real disagreement
  const ratingRows: (typeof schema.ratings.$inferInsert)[] = [];
  for (const [handle, ids] of lists) {
    if (handle === "will") continue; // Will starts with an empty ratings shelf so the flow is fresh to try
    const userId = demoUserId(handle);
    const picks = new Map<string, RatingBucket>();
    ids.slice(0, 8).forEach((id, i) => picks.set(id, i < 5 ? "loved" : "fine"));
    for (const [other, otherIds] of lists) {
      if (other === handle) continue;
      for (const id of otherIds.slice(0, 6)) {
        if (picks.has(id) || rand() < 0.45) continue;
        const r = rand();
        picks.set(id, r < 0.45 ? "loved" : r < 0.8 ? "fine" : "disliked");
      }
    }
    const byBucket: Record<RatingBucket, string[]> = { loved: [], fine: [], disliked: [] };
    for (const [id, b] of picks) byBucket[b].push(id);
    for (const bucket of ["loved", "fine", "disliked"] as const) {
      const ids2 = byBucket[bucket];
      const scores = bucketScores(bucket, ids2.length);
      ids2.forEach((trackId, i) =>
        ratingRows.push({
          userId,
          trackId,
          bucket,
          ord: i + 1,
          score: scores[i],
          note: rand() < 0.25 ? TAKES[Math.floor(rand() * TAKES.length)] : null,
          comparisons: Math.max(1, Math.ceil(Math.log2(i + 2))),
          createdAt: ago(rand() * 96),
          updatedAt: ago(rand() * 24),
        }),
      );
    }
  }
  await ins(schema.ratings, ratingRows);
}
