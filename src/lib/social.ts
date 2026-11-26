import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ListKind, Track, User } from "@/db/schema";
import { artistLine } from "./songs";

/**
 * The social layer reads every list in the group at once: who shares which songs,
 * what you could steal from a friend, and which friends echo a song on someone's column.
 * Songs match by songKey (same song, any version), so a remaster still counts.
 */

export type Person = Pick<User, "id" | "name" | "handle" | "color">;
type Row = { user: Person; kind: ListKind; position: number; track: Track };

async function groupRows(crewId: string): Promise<Row[]> {
  const db = await getDb();
  return db
    .select({
      user: { id: schema.users.id, name: schema.users.name, handle: schema.users.handle, color: schema.users.color },
      kind: schema.listEntries.kind,
      position: schema.listEntries.position,
      track: schema.tracks,
    })
    .from(schema.listEntries)
    .innerJoin(schema.users, eq(schema.users.id, schema.listEntries.userId))
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listEntries.trackId))
    .where(eq(schema.users.crewId, crewId));
}

const keyOf = (t: Track) => t.songKey || t.id;

export type Holder = { user: Person; rank: number };
export type Shared = { track: Track; holders: Holder[] };
export type StealPick = { track: Track; artists: string; from: Person; rank: number };

export async function getSocial(crewId: string, meId: string | null) {
  const rows = await groupRows(crewId);
  const allTime = rows.filter((r) => r.kind === "all_time");
  const byKey = new Map<string, Row[]>();
  for (const r of allTime) {
    const k = keyOf(r.track);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const mine = new Set(rows.filter((r) => r.user.id === meId).map((r) => keyOf(r.track)));

  /** Songs on two or more people's all-time lists. */
  const shared: Shared[] = [...byKey.values()]
    .map((list) => {
      const seen = new Map<string, Holder>();
      for (const r of list) if (!seen.has(r.user.id)) seen.set(r.user.id, { user: r.user, rank: r.position });
      return { track: list[0].track, holders: [...seen.values()].sort((a, b) => a.rank - b.rank) };
    })
    .filter((s) => s.holders.length > 1)
    .sort((a, b) => b.holders.length - a.holders.length || avg(a.holders) - avg(b.holders));

  /** Friends' songs you don't have yet, favoring what they rank highest. A fresh handful each day. */
  const day = Math.floor(Date.now() / 86_400_000);
  const candidates = allTime.filter((r) => r.user.id !== meId && !mine.has(keyOf(r.track)));
  const seenKeys = new Set<string>();
  const picks: StealPick[] = candidates
    .map((r) => ({ r, score: hash(`${day}:${r.user.id}:${r.track.id}`) * Math.sqrt(r.position) }))
    .sort((a, b) => a.score - b.score)
    .filter(({ r }) => {
      const k = keyOf(r.track);
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    })
    .slice(0, 8)
    .map(({ r }) => ({ track: r.track, artists: artistLine(r.track.artists), from: r.user, rank: r.position }));

  /** For one person's column: which other friends also have each song, and at what rank. */
  const echoesFor = (personId: string) => {
    const out = new Map<string, Holder[]>();
    for (const [k, list] of byKey) {
      const others = list.filter((r) => r.user.id !== personId).map((r) => ({ user: r.user, rank: r.position }));
      if (others.length) out.set(k, others);
    }
    return (t: Track) => out.get(keyOf(t)) ?? [];
  };

  return { shared, picks, echoesFor, has: (t: Track) => mine.has(keyOf(t)) };
}

function avg(h: Holder[]) {
  return h.reduce((s, x) => s + x.rank, 0) / h.length;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
