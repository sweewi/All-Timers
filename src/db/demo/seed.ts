/**
 * Demo data for the preview sandbox: six members with real songs, stories and reactions, so every page has something on it. Deterministic (same data on every
 * cold start) and only ever written into the throwaway embedded database.
 */
import { songKey } from "@/lib/songs";
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

const STORIES = [
  { foundVia: "friend", love: "That first chorus hits like a wave.", story: "Played it on loop the whole drive back from the coast.", moment: "the key change" },
  { foundVia: "grew_up", love: "Sounds like Saturday mornings.", story: "My parents had this on every road trip.", moment: null },
  { foundVia: "live", love: "The crowd sang the last verse back.", story: "Saw it live in a tiny room and never recovered.", moment: "the last verse" },
  { foundVia: "playlist", love: "The way it builds and never quite breaks.", story: "Snuck up on me in a random playlist at the gym.", moment: null },
  { foundVia: "friend", love: "It's the song I put on when I need to remember who I am.", story: "Sophomore year, walking home at 3 a.m. in the snow.", moment: "the bridge" },
  { foundVia: "screen", love: "Ten seconds in and I'm somewhere else.", story: "Heard it at the end of a film and sat through the whole credits.", moment: "the opening synth" },
  { foundVia: "grew_up", love: "My dad's favorite. Now it's mine.", story: "He played it every Sunday while making pancakes.", moment: null },
  { foundVia: "myself", love: "Perfect from the first note to the fade.", story: null, moment: "the drum fill at 2:10" },
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
    const at = ago(24 * 12 + rand() * 96); // lists went up before anyone set theirs in stone
    for (const [i, trackId] of ids.entries()) {
      entries.push({ userId, kind: "all_time", trackId, position: i + 1, addedAt: at });
      if (i < 5) events.push({ id: `demo-ev-${handle}-${i}`, batchId, userId, kind: "all_time", trackId, type: "add", toPos: i + 1, createdAt: at });
    }
  }
  await ins(schema.listEntries, entries);
  await ins(schema.rankEvents, events);

  // whys on each person's top three, a put-on between friends now and then
  const origins = lists.flatMap(([handle, ids], i) =>
    ids.slice(0, 3).map((trackId, k) => {
      const s = STORIES[(i * 3 + k) % STORIES.length];
      const from = s.foundVia === "friend" ? demoUserId(lists[(i + 1) % lists.length][0]) : null;
      return { id: `demo-origin-${handle}-${k}`, userId: demoUserId(handle), trackId, fromUserId: from, foundVia: s.foundVia, love: s.love, story: s.story, moment: s.moment, updatedAt: ago(5 + i * 7 + k * 3) };
    }),
  );
  await ins(schema.origins, origins);

  const reactions = [];
  const kinds = ["laurel", "fire", "cry", "same"] as const;
  for (const [owner, ids] of lists)
    for (const [reactor] of lists) {
      if (reactor === owner || rand() < 0.5) continue;
      reactions.push({ id: `demo-react-${reactor}-${owner}`, userId: demoUserId(reactor), target: `song:${demoUserId(owner)}:${ids[0]}`, kind: kinds[Math.floor(rand() * kinds.length)], createdAt: ago(rand() * 48) });
    }
  await ins(schema.reactions, reactions);

  // list identities: two lists already set in stone, rules in people's own words
  await ins(schema.listProfiles, [
    { userId: demoUserId("sam"), setAt: ago(24 * 9), rules: "Songs I'd still play at 80. If I ever skipped it, it's out.", shareToken: "demo-share-sam-0001" },
    { userId: demoUserId("maya"), setAt: ago(30), rules: "Every one of these got me through something." },
    { userId: demoUserId("ava"), rules: "First listen gave me chills, tenth listen still does." },
    { userId: demoUserId("theo"), rules: "No guilty pleasures. Only songs I'd defend." },
  ]);
  // a song added to a list already set in stone
  const samList = data.lists.sam ?? [];
  const inducted = data.tracks.find((t) => !samList.includes(t.id));
  if (inducted) {
    await ins(schema.listEntries, [{ userId: demoUserId("sam"), kind: "all_time", trackId: inducted.id, position: samList.length + 1, addedAt: ago(20) }]);
    await ins(schema.rankEvents, [
      { id: "demo-ev-sam-induct", batchId: "demo-batch-sam-induct", userId: demoUserId("sam"), kind: "all_time", trackId: inducted.id, type: "add", toPos: samList.length + 1, createdAt: ago(20) },
    ]);
  }
}
