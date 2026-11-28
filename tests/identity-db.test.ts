// List identity against a real (embedded) Postgres: profiles, share tokens, the plaza's news.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PGLITE_DIR = mkdtempSync(path.join(tmpdir(), "at-identity-"));
delete process.env.DATABASE_URL;
delete process.env.VERCEL_ENV;

type Db = typeof import("../src/db");
let getDb: Db["getDb"];
let schema: Db["schema"];
let P: typeof import("../src/lib/profile");
let plaza: typeof import("../src/lib/plaza");
let lists: typeof import("../src/lib/lists");
const ids = Array.from({ length: 6 }, (_, i) => `t${String(i).padStart(21, "0")}`);

before(async () => {
  ({ getDb, schema } = await import("../src/db"));
  P = await import("../src/lib/profile");
  plaza = await import("../src/lib/plaza");
  lists = await import("../src/lib/lists");
  const db = await getDb();
  await db.insert(schema.crews).values([
    { id: "c1", name: "One", inviteCode: "invite-one" },
    { id: "c2", name: "Two", inviteCode: "invite-two" },
  ]);
  await db.insert(schema.users).values([
    { id: "u1", crewId: "c1", name: "A", handle: "a", color: "#111111" },
    { id: "u2", crewId: "c1", name: "B", handle: "b", color: "#222222" },
    { id: "u3", crewId: "c2", name: "C", handle: "c", color: "#333333" },
  ]);
  await db.insert(schema.memberships).values([
    { userId: "u1", crewId: "c1" },
    { userId: "u2", crewId: "c1" },
    { userId: "u3", crewId: "c2" },
  ]);
  await db.insert(schema.tracks).values(ids.map((id, i) => ({ id, name: `Song ${i}`, songKey: `s${i}`, metaSource: "none" })));
});

test("profiles are created on first patch and updated after", async () => {
  assert.equal(await P.getProfile("u1"), null);
  await P.patchProfile("u1", { rules: "Only bangers." });
  await P.patchProfile("u1", { playlistId: "p".repeat(22) });
  const p = await P.getProfile("u1");
  assert.equal(p?.rules, "Only bangers.");
  assert.equal(p?.playlistId, "p".repeat(22));
});

test("share tokens: made once, look up their owner, can be replaced or turned off", async () => {
  const t1 = await P.ensureShareToken("u1");
  assert.equal(await P.ensureShareToken("u1"), t1);
  assert.equal((await P.ownerOfShareToken(t1))?.user.id, "u1");
  assert.equal(await P.ownerOfShareToken("not a token!"), null);
  await P.resetShareToken("u1", true);
  assert.equal(await P.ownerOfShareToken(t1), null);
  await P.resetShareToken("u1", false);
  assert.equal((await P.getProfile("u1"))?.shareToken, null);
});

test("card styles fall back to defaults on bad input", () => {
  assert.deepEqual(P.cardOf({ card: "{not json" }), P.DEFAULT_CARD);
  const c = P.cardOf({ card: JSON.stringify({ theme: "neon", layout: "wall", headline: "  My   picks  " }) });
  assert.equal(c.theme, "marble");
  assert.equal(c.layout, "wall");
  assert.equal(c.headline, "My picks");
});

test("the plaza's news: set in stone, additions after it are inductions, other groups stay out", async () => {
  await lists.saveList("u1", "all_time", ids.slice(0, 4));
  await lists.saveList("u3", "all_time", ids.slice(0, 2)); // another group
  const db = await getDb();
  // the list went up an hour ago, then was set in stone
  await db.update(schema.rankEvents).set({ createdAt: new Date(Date.now() - 3_600_000) });
  await P.patchProfile("u1", { setAt: new Date(Date.now() - 1_800_000) });
  await lists.saveList("u1", "all_time", [...ids.slice(0, 4), ids[4]]);
  const news = await plaza.getNews("c1");
  assert.ok(news.some((n) => n.type === "stone" && n.user.id === "u1" && n.count === 5));
  const added = news.filter((n) => n.type === "added");
  assert.ok(added.some((n) => n.type === "added" && n.afterStone && n.tracks[0].track.id === ids[4]));
  assert.ok(added.some((n) => n.type === "added" && !n.afterStone));
  assert.ok(news.every((n) => n.user.id !== "u3"));
});

test("whys only come from songs still on someone's list", async () => {
  const db = await getDb();
  await db.insert(schema.origins).values([
    { id: "o1", userId: "u1", trackId: ids[0], love: "Still on the list" },
    { id: "o2", userId: "u1", trackId: ids[5], love: "Dropped from the list" },
  ]);
  const whys = await plaza.recentWhys("c1");
  assert.deepEqual(whys.map((w) => w.love), ["Still on the list"]);
});
