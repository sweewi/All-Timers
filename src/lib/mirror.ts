import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { MonthlyRound } from "@/db/schema";
import { getList } from "./lists";
import { monthLabel } from "./listening";
import { NetError, safeFetchJson } from "./net";
import { rateLimit, RateLimited } from "./ratelimit";
import { getOwnerToken } from "./spotify";
import { after } from "next/server";

/**
 * Spotify mirrors, kept on the app owner's account (the "playlist hub"): one playlist
 * per column, in rank order, and one per finished month. Spotify only lets an app
 * write playlists for the account that signed in, so everyone follows the hub's
 * playlists instead of having their own synced. Needs SPOTIFY_CLIENT_ID/SECRET and
 * the owner's "Connect Spotify" in Settings; without them every call is a no-op.
 */

const API = "https://api.spotify.com/v1";
const CHUNK = 100; // Spotify's per-request limit for playlist items

const Created = z.object({ id: z.string(), external_urls: z.object({ spotify: z.string() }).partial().optional(), snapshot_id: z.string().optional() });
const Snapshot = z.object({ snapshot_id: z.string() }).partial();

async function call<T>(token: string, method: "POST" | "PUT", path: string, body: unknown, schema: z.ZodType<T>) {
  const { data } = await safeFetchJson(`${API}${path}`, schema, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // PUT (replace) is safe to repeat; POST (create / append) is not
    retries: method === "PUT" ? 1 : 0,
    maxBytes: 200_000,
    timeoutMs: 12_000,
  });
  return data;
}

type MirrorResult = { ok: true; url: string | null; tracks: number } | { ok: false; reason: string };

async function sync(key: string, name: string, description: string, trackIds: string[]): Promise<MirrorResult> {
  const token = await getOwnerToken();
  if (!token) return { ok: false, reason: "Spotify isn't connected (Settings → Spotify)." };
  try {
    await rateLimit(`mirror:${key}`, 6, 600);
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, reason: "Synced a lot recently; the daily sync will catch up." };
    throw e;
  }
  const db = await getDb();
  const existing = (await db.select().from(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key)))[0];
  const uris = trackIds.filter((id) => /^[A-Za-z0-9]{22}$/.test(id)).map((id) => `spotify:track:${id}`);
  try {
    let playlistId = existing?.playlistId;
    let url = existing?.url ?? null;
    if (!playlistId) {
      const made = await call(token, "POST", "/me/playlists", { name: name.slice(0, 100), description: description.slice(0, 300), public: true }, Created);
      playlistId = made.id;
      url = made.external_urls?.spotify ?? `https://open.spotify.com/playlist/${made.id}`;
      // remember it at once, so a failure below never creates a duplicate next time
      await db
        .insert(schema.spotifyMirrors)
        .values({ key, playlistId, url })
        .onConflictDoUpdate({ target: schema.spotifyMirrors.key, set: { playlistId, url } });
    }
    // replace with the first 100 (an empty list clears it), then append the rest in order
    let snap = await call(token, "PUT", `/playlists/${playlistId}/items`, { uris: uris.slice(0, CHUNK) }, Snapshot);
    for (let i = CHUNK; i < uris.length; i += CHUNK) {
      snap = await call(token, "POST", `/playlists/${playlistId}/items`, { uris: uris.slice(i, i + CHUNK) }, Snapshot);
    }
    await db
      .update(schema.spotifyMirrors)
      .set({ snapshotId: snap.snapshot_id ?? null, syncedAt: new Date(), lastError: null })
      .where(eq(schema.spotifyMirrors.key, key));
    return { ok: true, url, tracks: uris.length };
  } catch (e) {
    const msg = e instanceof NetError ? `${e.message}${e.status ? ` (${e.status})` : ""}` : String(e);
    console.error("spotify mirror", { key, err: msg });
    // the playlist was deleted on Spotify's side: forget it so the next sync makes a new one
    if (e instanceof NetError && e.status === 404 && existing) await db.delete(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key));
    else await db.update(schema.spotifyMirrors).set({ lastError: msg.slice(0, 300) }).where(eq(schema.spotifyMirrors.key, key));
    return { ok: false, reason: "Spotify refused the update. It'll retry with the daily sync." };
  }
}

export async function mirrorColumn(userId: string) {
  const db = await getDb();
  const user = (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0];
  if (!user) return { ok: false as const, reason: "no such member" };
  const list = await getList(userId, "all_time");
  if (!list.length) return { ok: false as const, reason: "empty list" };
  return sync(`column:${userId}`, `${user.name}'s All-Timers`, `Ranked, #1 first. Kept in sync by All-Timers.`, list.map((e) => e.track.id));
}

export async function mirrorMonth(round: MonthlyRound) {
  if (round.status !== "revealed") return { ok: false as const, reason: "not revealed yet" };
  const db = await getDb();
  const rows = await db
    .select({ trackId: schema.monthlyResults.trackId })
    .from(schema.monthlyResults)
    .where(eq(schema.monthlyResults.roundId, round.id))
    .orderBy(asc(schema.monthlyResults.position));
  if (!rows.length) return { ok: false as const, reason: "nothing to mirror" };
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, round.crewId)))[0];
  return sync(`month:${round.id}`, `${crew?.name ?? "All-Timers"}: ${monthLabel(round.month)}`, `The group's list for ${monthLabel(round.month)}, voted on All-Timers.`, rows.map((r) => r.trackId));
}

/** Is the owner hub available at all? (cheap: no network) */
export async function hubConnected() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) return false;
  const db = await getDb();
  return (await db.select().from(schema.settings).where(eq(schema.settings.key, "spotify_refresh_token"))).length > 0;
}

/** The hub playlist for a column ("column:<userId>") or month ("month:<roundId>"), if one exists. */
export async function getMirror(key: string) {
  const db = await getDb();
  return (await db.select().from(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key)))[0] ?? null;
}

/** After this request: refresh this person's column playlist on the hub, if there is a hub. */
export function queueColumnMirror(userId: string) {
  after(async () => {
    if (await hubConnected()) await mirrorColumn(userId);
  });
}

/** Everything, for the daily cron and the admin button. One playlist at a time. */
export async function mirrorCrew(crewId: string) {
  if (!(await hubConnected())) return { synced: 0, failed: 0, skipped: true };
  const db = await getDb();
  const members = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.crewId, crewId));
  let synced = 0;
  let failed = 0;
  for (const m of members) {
    const r = await mirrorColumn(m.id);
    if (r.ok) synced++;
    else if (r.reason !== "empty list") failed++;
  }
  const rounds = await db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.crewId, crewId));
  for (const r of rounds.filter((x) => x.status === "revealed")) {
    if (await getMirror(`month:${r.id}`)) continue;
    const res = await mirrorMonth(r);
    if (res.ok) synced++;
    else failed++;
  }
  return { synced, failed, skipped: false };
}
