// Builds src/db/demo/fixture.json from the local dev database: songs + example lists.
import { writeFileSync, mkdirSync } from "node:fs";
import { getDb, schema } from "@/db";
import { asc } from "drizzle-orm";
(async () => {
  const db = await getDb();
  const users = await db.select().from(schema.users);
  const entries = await db.select().from(schema.listEntries).orderBy(asc(schema.listEntries.position));
  const tracks = await db.select().from(schema.tracks);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const lists: Record<string, string[]> = {};
  for (const e of entries) if (e.kind === "all_time") (lists[users.find((u) => u.id === e.userId)!.handle] ??= []).push(e.trackId);
  const theoDeck = entries.filter((e) => e.kind === "on_deck").map((e) => e.trackId);
  // two extra demo members built from other real songs in the database
  const extra = tracks.filter((t) => t.imageUrl && !Object.values(lists).flat().includes(t.id)).map((t) => t.id);
  lists.maya = theoDeck.slice(0, 18);
  lists.jonah = extra.filter((id) => !theoDeck.includes(id)).slice(0, 16);
  const used = new Set([...Object.values(lists).flat(), ...extra.slice(0, 140)]);
  const fixture = {
    lists,
    tracks: [...used].map((id) => byId.get(id)!).filter(Boolean).map((t) => ({
      id: t.id, name: t.name, artists: t.artists, album: t.album, releaseYear: t.releaseYear, imageUrl: t.imageUrl,
      artColor: (t as Record<string, unknown>).artColor ?? null, durationMs: t.durationMs, songKey: t.songKey,
    })),
  };
  mkdirSync("src/db/demo", { recursive: true });
  writeFileSync("src/db/demo/fixture.json", JSON.stringify(fixture));
  console.log(Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])), "tracks", fixture.tracks.length);
  process.exit(0);
})();
