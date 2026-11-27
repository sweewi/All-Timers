import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketScores,
  groupChart,
  isHotTake,
  maxQuestions,
  needsRenumber,
  ordBetween,
  scoreAt,
  searchDone,
  searchMid,
  searchStep,
  searchTie,
  startSearch,
  tasteMatch,
} from "../src/lib/rating-math";

test("bands: loved above fine above not-for-me, scores inside each band", () => {
  for (const n of [1, 2, 7, 50]) {
    const loved = bucketScores("loved", n);
    const fine = bucketScores("fine", n);
    const bad = bucketScores("disliked", n);
    assert.ok(Math.min(...loved) >= 6.7 && Math.max(...loved) <= 10);
    assert.ok(Math.min(...fine) >= 3.4 && Math.max(...fine) <= 6.7);
    assert.ok(Math.min(...bad) >= 0 && Math.max(...bad) <= 3.4);
    assert.ok(Math.min(...loved) >= Math.max(...fine));
    // best first, never increasing
    assert.ok(loved.every((x, i) => i === 0 || loved[i - 1] >= x));
  }
  assert.equal(scoreAt("loved", 0, 1), 8.4);
  assert.ok(scoreAt("loved", 0, 50) > 9.8);
});

test("binary insertion finds the right slot for every possible answer pattern", () => {
  // the bucket is [0, 1, 2, …, n-1] by strength (0 best); insert a song of strength s
  for (const n of [0, 1, 2, 5, 8, 31]) {
    for (let target = 0; target <= n; target++) {
      let s = startSearch(n);
      while (!searchDone(s)) s = searchStep(s, target <= searchMid(s));
      assert.equal(s.lo, target, `n=${n} target=${target}`);
      assert.ok(s.asked <= maxQuestions(n), `asked ${s.asked} > max ${maxQuestions(n)} for n=${n}`);
    }
  }
  assert.equal(maxQuestions(30), 5);
  assert.equal(maxQuestions(100), 7);
});

test("too close to call settles next to the compared song", () => {
  const s = searchTie(startSearch(10));
  assert.ok(searchDone(s));
  assert.equal(s.lo, 5);
});

test("ords: midpoints, ends, and renumber detection", () => {
  assert.equal(ordBetween(null, null), 0);
  assert.equal(ordBetween(null, 3), 4);
  assert.equal(ordBetween(3, null), 2);
  assert.equal(ordBetween(4, 2), 3);
  let a = 1;
  const b = 0;
  for (let i = 0; i < 80; i++) a = ordBetween(a, b);
  assert.ok(needsRenumber([1, a, b]) || a - b < 1e-20);
  assert.equal(needsRenumber([3, 2, 1]), false);
});

test("taste match: same taste high, opposite low, too few songs null", () => {
  const a = new Map([["x", 9], ["y", 5], ["z", 2], ["w", 7]]);
  assert.equal(tasteMatch(a, new Map(a)).match, 100);
  const opp = new Map([...a].map(([k, v]) => [k, 10 - v]));
  assert.equal(tasteMatch(a, opp).match, 0);
  assert.equal(tasteMatch(a, new Map([["x", 9], ["y", 1]])).match, null);
});

test("group chart: one perfect score doesn't beat a crowd of 9s", () => {
  const rows = [
    { trackId: "solo", score: 10 },
    ...["a", "b", "c", "d", "e"].map(() => ({ trackId: "crowd", score: 9 })),
    { trackId: "meh", score: 4 },
    { trackId: "meh", score: 5 },
  ];
  const chart = groupChart(rows);
  assert.equal(chart[0].trackId, "crowd");
  assert.equal(chart[0].raters, 5);
  assert.equal(chart.at(-1)!.trackId, "meh");
});

test("hot takes need company to disagree with", () => {
  assert.equal(isHotTake(2, [9, 8.5]), true);
  assert.equal(isHotTake(2, [9]), false);
  assert.equal(isHotTake(7, [8, 9]), false);
});
