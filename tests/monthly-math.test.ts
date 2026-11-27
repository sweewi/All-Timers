import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, revealAt, tally } from "../src/lib/monthly-math";

test("pool weights each person equally, however much they listen", () => {
  const heavy = Array.from({ length: 5 }, (_, i) => ({ trackId: `h${i}`, rank: i + 1, streams: 500 - i }));
  const light = Array.from({ length: 5 }, (_, i) => ({ trackId: `l${i}`, rank: i + 1, streams: 5 - i }));
  const pool = buildPool(new Map([["heavy", heavy], ["light", light]]), 5, 30);
  const w = new Map(pool.map((p) => [p.trackId, p.weight]));
  assert.equal(w.get("h0"), w.get("l0"));
  assert.equal(w.get("h4"), w.get("l4"));
  assert.equal(pool.length, 10);
});

test("a song two people played outranks either person's #1 alone", () => {
  const pool = buildPool(
    new Map([
      ["a", [{ trackId: "x", rank: 1, streams: 9 }, { trackId: "shared", rank: 2, streams: 8 }]],
      ["b", [{ trackId: "y", rank: 1, streams: 9 }, { trackId: "shared", rank: 2, streams: 8 }]],
    ]),
    5,
  );
  assert.equal(pool[0].trackId, "shared");
  assert.equal(pool[0].detail.length, 2);
});

test("pool is capped and only takes each person's top N", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ trackId: `t${i}`, rank: i + 1, streams: 20 - i }));
  assert.equal(buildPool(new Map([["a", many]]), 5, 30).length, 5);
  const crowd = new Map(Array.from({ length: 10 }, (_, u) => [`u${u}`, many.slice(0, 5).map((m) => ({ ...m, trackId: `${u}-${m.trackId}` }))]));
  assert.equal(buildPool(crowd, 5, 30).length, 30);
});

test("tally: averaged Borda, a song only one voter loved can't beat a consensus pick", () => {
  const r = tally(
    new Map([
      ["a", ["niche", "consensus"]],
      ["b", ["consensus"]],
      ["c", ["consensus", "niche"]],
    ]),
    ["niche", "consensus"],
  );
  assert.equal(r[0].trackId, "consensus");
  assert.equal(r[0].voters, 3);
  assert.equal(r[0].position, 1);
  assert.ok(r[0].score <= 1 && r[0].score > 0);
});

test("tally ignores songs not in the pool and duplicate entries", () => {
  const r = tally(new Map([["a", ["x", "x", "ghost", "y"]]]), ["x", "y"]);
  assert.deepEqual(r.map((t) => t.trackId), ["x", "y"]);
  assert.equal(r[0].score, 1);
  assert.equal(r[1].score, 0.5);
});

test("tally with no ballots falls back to pool order", () => {
  const r = tally(new Map(), ["a", "b", "c"]);
  assert.deepEqual(r.map((t) => t.trackId), ["a", "b", "c"]);
  assert.ok(r.every((t) => t.score === 0));
});

test("ties break on first places", () => {
  // a: [p, q], b: [q, p] → equal Borda; c ranks only q first → q has more firsts
  const r = tally(new Map([["a", ["p", "q"]], ["b", ["q", "p"]]]), ["p", "q"]);
  assert.equal(r[0].score, r[1].score);
  assert.equal(r[0].trackId, "p"); // equal firsts and voters → pool order
  const r2 = tally(new Map([["a", ["p", "q"]], ["b", ["q", "p"]], ["c", ["q"]]]), ["p", "q"]);
  assert.equal(r2[0].trackId, "q");
});

test("reveal is 8pm on the month's last day", () => {
  const nextMonthMidnight = Date.UTC(2026, 11, 1, 5); // Dec 1 00:00 EST
  assert.equal(revealAt(nextMonthMidnight), Date.UTC(2026, 11, 1, 1)); // Nov 30 20:00 EST
});
