import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatsfmHandle } from "../src/lib/statsfm";
import { parsePlaylistInput } from "../src/lib/playlist";
import { monthKeyOf, monthStart, monthWindow } from "../src/lib/listening";
import { parseTrackInput } from "../src/lib/spotify";

test("stats.fm handles: names, @names, links; rejects junk", () => {
  assert.equal(parseStatsfmHandle("martijn"), "martijn");
  assert.equal(parseStatsfmHandle("  @martijn "), "martijn");
  assert.equal(parseStatsfmHandle("https://stats.fm/user/martijn"), "martijn");
  assert.equal(parseStatsfmHandle("stats.fm/martijn?ref=share"), "martijn");
  assert.equal(parseStatsfmHandle("https://stats.fm/user/martijn/tracks"), "martijn");
  assert.equal(parseStatsfmHandle("../../admin"), null);
  assert.equal(parseStatsfmHandle("a b"), null);
  assert.equal(parseStatsfmHandle("https://evil.example/user/x"), null);
  assert.equal(parseStatsfmHandle(""), null);
  assert.equal(parseStatsfmHandle("x".repeat(65)), null);
});

test("playlist links from phone share sheets, URIs and bare ids", () => {
  const id = "37i9dQZF1DX4UtSsGT1Sbe";
  assert.equal(parsePlaylistInput(`https://open.spotify.com/playlist/${id}?si=abc123`), id);
  assert.equal(parsePlaylistInput(`spotify:playlist:${id}`), id);
  assert.equal(parsePlaylistInput(`https://open.spotify.com/intl-de/playlist/${id}`), id);
  assert.equal(parsePlaylistInput(id), id);
  assert.equal(parsePlaylistInput(`https://open.spotify.com/track/${id}`), null);
  assert.equal(parsePlaylistInput("nope"), null);
});

test("track links keep order and drop duplicates", () => {
  const a = "4uLU6hMCjMI75M1A2tKUQC", b = "7GhIk7Il098yCjg4BQjzvb";
  const r = parseTrackInput(`https://open.spotify.com/track/${a}\nhttps://open.spotify.com/track/${b}?si=1 spotify:track:${a}`);
  assert.deepEqual(r.ids, [a, b]);
  assert.equal(r.duplicates, 1);
});

test("calendar months in the app's timezone (America/New_York)", () => {
  assert.equal(monthStart(2026, 11, "America/New_York"), Date.UTC(2026, 10, 1, 4)); // EDT
  assert.equal(monthStart(2026, 12, "America/New_York"), Date.UTC(2026, 11, 1, 5)); // EST
  const w = monthWindow("2026-03", "America/New_York");
  assert.equal(w.after, Date.UTC(2026, 2, 1, 5));
  assert.equal(w.before, Date.UTC(2026, 3, 1, 4)); // DST began in March
  assert.equal(monthKeyOf(Date.UTC(2026, 11, 1, 3), "America/New_York"), "2026-11"); // still Nov 30 in NY
  assert.equal(monthKeyOf(Date.UTC(2026, 11, 1, 6), "America/New_York"), "2026-12");
  const dec = monthWindow("2026-12", "America/New_York");
  assert.equal(dec.before, Date.UTC(2027, 0, 1, 5));
});
