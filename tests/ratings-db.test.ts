// Placement, rescoring and stale-anchor handling against a real (embedded) Postgres.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "at-ratings-"));
delete process.env.DATABASE_URL;
delete process.env.VERCEL_ENV;

type Db = typeof import("../src/db");
let getDb: Db["getDb"];
let schema: Db["schema"];
let R: typeof import("../src/lib/ratings");
const ids = Array.from({ length: 8 }, (_, i) => `t${String(i).padStart(21, "0")}`);

before(async () => {
  ({ getDb, schema } = await import("../src/db"));
  R = await import("../src/lib/ratings");
  const db = await getDb();
  await db.insert(schema.crews).values({ id: "c1", name: "C", inviteCode: "x" });
  await db.insert(schema.users).values([
    { id: "u1", crewId: "c1", name: "A", handle: "a", color: "#111111" },
    { id: "u2", crewId: "c1", name: "B", handle: "b", color: "#222222" },
  ]);
  await db.insert(schema.memberships).values([{ userId: "u1", crewId: "c1" }, { userId: "u2", crewId: "c1" }]);
  await db.insert(schema.tracks).values(ids.map((id, i) => ({ id, name: `Song ${i}`, songKey: `s${i}`, metaSource: "none" })));
});

const order = async (user: string, bucket: "loved" | "fine" | "disliked") => (await R.getBucket(user, bucket)).map((r) => r.trackId);

test("first song in a bucket sits mid-band; better songs go above", async () => {
  const a = await R.placeRating({ userId: "u1", trackId: ids[0], bucket: "loved", above: null, below: null, comparisons: 0 });
  assert.equal(a.score, 8.4);
  assert.deepEqual([a.rank, a.total], [1, 1]);
  const b = await R.placeRating({ userId: "u1", trackId: ids[1], bucket: "loved", above: null, below: ids[0], comparisons: 1 });
  assert.equal(b.rank, 1);
  assert.deepEqual(await order("u1", "loved"), [ids[1], ids[0]]);
});

test("placing between two neighbours keeps a strict order and even scores", async () => {
  await R.placeRating({ userId: "u1", trackId: ids[2], bucket: "loved", above: ids[1], below: ids[0], comparisons: 2 });
  assert.deepEqual(await order("u1", "loved"), [ids[1], ids[2], ids[0]]);
  const scores = (await R.getBucket("u1", "loved")).map((r) => r.score);
  assert.ok(scores[0] > scores[1] && scores[1] > scores[2]);
  assert.ok(scores.every((s) => s > 6.7 && s < 10));
});

test("stale anchors from another bucket are ignored instead of corrupting the order", async () => {
  await R.placeRating({ userId: "u1", trackId: ids[3], bucket: "fine", above: null, below: null, comparisons: 0 });
  // ids[3] is in "fine", not "loved": the server must not use it as an anchor
  await R.placeRating({ userId: "u1", trackId: ids[4], bucket: "loved", above: ids[3], below: ids[0], comparisons: 1 });
  const loved = await order("u1", "loved");
  assert.equal(loved.length, 4);
  assert.ok(loved.indexOf(ids[4]) < loved.indexOf(ids[0]));
});

test("re-rating moves a song across buckets and rescores both", async () => {
  await R.placeRating({ userId: "u1", trackId: ids[2], bucket: "disliked", above: null, below: null, comparisons: 0 });
  assert.ok(!(await order("u1", "loved")).includes(ids[2]));
  assert.deepEqual(await order("u1", "disliked"), [ids[2]]);
  const r = await R.getRating("u1", ids[2]);
  assert.ok(r && r.score < 3.4);
});

test("notes are trimmed and capped; removing a rating rescores the rest", async () => {
  await R.setNote("u1", ids[0], `  ${"x".repeat(400)}  `);
  assert.equal((await R.getRating("u1", ids[0]))!.note!.length, 280);
  await R.removeRating("u1", ids[4]);
  assert.equal((await order("u1", "loved")).length, 2);
});

test("taste match needs 3 shared songs, and hot takes need 2 others", async () => {
  for (const [i, b] of [[0, "loved"], [1, "loved"], [3, "fine"]] as const)
    await R.placeRating({ userId: "u2", trackId: ids[i], bucket: b, above: null, below: null, comparisons: 0 });
  const m = await R.tasteMatches("u1", "c1");
  assert.equal(m.get("u2")!.shared, 3);
  const takes = await R.freshTakes("c1");
  assert.ok(takes.every((t) => t.hot === false)); // only one other rater per song
});

test("search escapes LIKE wildcards", async () => {
  assert.equal((await R.searchKnownTracks("%%")).length, 0);
});
