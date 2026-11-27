import "server-only";
import { createHash } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { MonthlyRound } from "@/db/schema";
import { monthLabel } from "./listening";
import { NetError, safeFetchJson, safeFetchText } from "./net";
import { rateLimit, RateLimited } from "./ratelimit";
import { getOwnerToken } from "./spotify";

/**
 * The monthly playlist, kept on a separate "hub" Spotify account (not anyone's
 * personal one). Spotify only lets an app write playlists to an account that signed
 * in, and development mode caps an app at five such accounts, so one hub account
 * holds the playlists and everyone saves them from there.
 *
 * One playlist per month: created as soon as the pool has songs, grown as the pool
 * grows (listen, then vote), and reordered into the group's final ranking at the
 * reveal. Needs SPOTIFY_CLIENT_ID/SECRET plus the hub account connected in Settings;
 * without them everything here is a no-op.
 */

const API = "https://api.spotify.com/v1";
const CHUNK = 100; // Spotify's per-request limit for playlist items

const Created = z.object({ id: z.string(), external_urls: z.object({ spotify: z.string() }).partial().optional() });
const Snapshot = z.object({ snapshot_id: z.string() }).partial();

class StepError extends Error {
  constructor(readonly step: string, readonly cause: unknown) {
    const detail = cause instanceof NetError ? `${cause.status ?? "network"}` : String(cause);
    super(`${step}: ${detail}`);
  }
}

async function call<T>(step: string, token: string, method: "POST" | "PUT", path: string, body: unknown, schema: z.ZodType<T>) {
  try {
    const { data } = await safeFetchJson(`${API}${path}`, schema, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // PUT (replace) is safe to repeat, and Spotify often answers 500/503 to a playlist
      // that was created a moment ago; POST (create / append) is never repeated blindly
      retries: method === "PUT" ? 3 : 0,
      maxBytes: 200_000,
      timeoutMs: 12_000,
    });
    return data;
  } catch (e) {
    throw new StepError(step, e);
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sha = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);

export type MirrorResult = { ok: true; url: string | null; tracks: number; unchanged?: boolean } | { ok: false; reason: string };

async function sync(key: string, name: string, description: string, trackIds: string[]): Promise<MirrorResult> {
  const token = await getOwnerToken();
  if (!token) return { ok: false, reason: "Spotify isn't connected (Settings → Spotify)." };
  const db = await getDb();
  const existing = (await db.select().from(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key)))[0];
  const uris = trackIds.filter((id) => /^[A-Za-z0-9]{22}$/.test(id)).map((id) => `spotify:track:${id}`);
  // "<description hash>:<songs hash>": skip unchanged syncs, notice when only the description moved
  const descTag = sha(description, 8);
  const stamp = `${descTag}:${sha(uris.join(","), 24)}`;
  if (existing?.contentHash === stamp && !existing.lastError) return { ok: true, url: existing.url, tracks: uris.length, unchanged: true };
  try {
    await rateLimit(`mirror:${key}`, 6, 600);
  } catch (e) {
    if (e instanceof RateLimited) return { ok: false, reason: "Synced a lot recently; the daily sync will catch up." };
    throw e;
  }
  try {
    let playlistId = existing?.playlistId;
    let url = existing?.url ?? null;
    if (!playlistId) {
      const made = await call("create playlist", token, "POST", "/me/playlists", { name: name.slice(0, 100), description: description.slice(0, 300), public: true }, Created);
      playlistId = made.id;
      url = made.external_urls?.spotify ?? `https://open.spotify.com/playlist/${made.id}`;
      // remember it at once, so a failure below never creates a duplicate next time
      await db
        .insert(schema.spotifyMirrors)
        .values({ key, playlistId, url })
        .onConflictDoUpdate({ target: schema.spotifyMirrors.key, set: { playlistId, url } });
      await pause(2000); // a brand-new playlist isn't writable for a moment
    } else if (existing?.contentHash && !existing.contentHash.startsWith(`${descTag}:`)) {
      // the description changes once, at the reveal; best effort (the songs matter more)
      await safeFetchText(`${API}/playlists/${playlistId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.slice(0, 300) }),
        retries: 0,
      }).catch((e) => console.error("spotify mirror details", { key, err: String(e) }));
    }
    // replace with the first 100 (an empty list clears it), then append the rest in order
    let snap = await call("set songs", token, "PUT", `/playlists/${playlistId}/items`, { uris: uris.slice(0, CHUNK) }, Snapshot);
    for (let i = CHUNK; i < uris.length; i += CHUNK) {
      snap = await call("add songs", token, "POST", `/playlists/${playlistId}/items`, { uris: uris.slice(i, i + CHUNK) }, Snapshot);
    }
    await db
      .update(schema.spotifyMirrors)
      .set({ snapshotId: snap.snapshot_id ?? null, contentHash: stamp, syncedAt: new Date(), lastError: null })
      .where(eq(schema.spotifyMirrors.key, key));
    return { ok: true, url, tracks: uris.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof StepError && e.cause instanceof NetError ? e.cause.status : null;
    console.error("spotify mirror", { key, err: msg });
    // deleted on Spotify's side: forget it so the next sync makes a new one
    if (status === 404 && existing) await db.delete(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key));
    else await db.update(schema.spotifyMirrors).set({ lastError: msg.slice(0, 300) }).where(eq(schema.spotifyMirrors.key, key));
    const hint =
      status === 403
        ? " Spotify said forbidden: is the hub account added under User Management in the developer dashboard?"
        : status === 401
          ? " The hub connection expired: reconnect it in Settings."
          : status && status >= 500
            ? " Spotify's servers hiccuped; it retries on the next sync."
            : "";
    return { ok: false, reason: `Spotify refused (${msg}).${hint}` };
  }
}

/** The month's songs in playlist order: the pool by weight while open, the final ranking once revealed. */
async function monthOrder(round: MonthlyRound) {
  const db = await getDb();
  if (round.status === "revealed") {
    const rows = await db
      .select({ trackId: schema.monthlyResults.trackId })
      .from(schema.monthlyResults)
      .where(eq(schema.monthlyResults.roundId, round.id))
      .orderBy(asc(schema.monthlyResults.position));
    return rows.map((r) => r.trackId);
  }
  const rows = await db
    .select({ trackId: schema.monthlyPool.trackId })
    .from(schema.monthlyPool)
    .where(eq(schema.monthlyPool.roundId, round.id))
    .orderBy(desc(schema.monthlyPool.weight), asc(schema.monthlyPool.addedAt));
  return rows.map((r) => r.trackId);
}

export async function mirrorMonth(round: MonthlyRound): Promise<MirrorResult> {
  const ids = await monthOrder(round);
  if (!ids.length) return { ok: false, reason: "nothing in the pool yet" };
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, round.crewId)))[0];
  const label = monthLabel(round.month);
  const description =
    round.status === "revealed"
      ? `The group's list for ${label}, ranked by everyone's votes on All-Timers.`
      : `${label}: everyone's most-played, plus nominations. Listen, then rank it on All-Timers. Becomes the group's ranking at the reveal.`;
  return sync(`month:${round.id}`, `${crew?.name ?? "All-Timers"} · ${label}`, description, ids);
}

/** Is a hub connected at all? (cheap: no network) */
export async function hubConnected() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) return false;
  const db = await getDb();
  return (await db.select().from(schema.settings).where(eq(schema.settings.key, "spotify_refresh_token"))).length > 0;
}

/** Bring the month's playlist up to date from the database's current state, if there is a hub. */
export async function syncMonth(roundId: string) {
  if (!(await hubConnected())) return;
  const db = await getDb();
  const fresh = (await db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.id, roundId)))[0];
  if (fresh) await mirrorMonth(fresh);
}

/** The same, after this request has been answered. */
export function queueMonthMirror(roundId: string) {
  after(() => syncMonth(roundId));
}

/** Every month that has songs, for the daily cron and the admin button. Unchanged ones cost nothing. */
export async function mirrorCrew(crewId: string) {
  if (!(await hubConnected())) return { synced: 0, failed: 0, skipped: true, errors: [] as string[] };
  const db = await getDb();
  const rounds = await db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.crewId, crewId));
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const r of rounds) {
    const res = await mirrorMonth(r);
    if (res.ok) synced++;
    else if (res.reason !== "nothing in the pool yet") {
      failed++;
      errors.push(`${monthLabel(r.month)}: ${res.reason}`);
    }
  }
  return { synced, failed, skipped: false, errors };
}

/** The hub playlist for a month ("month:<roundId>"), if one exists. */
export async function getMirror(key: string) {
  const db = await getDb();
  return (await db.select().from(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, key)))[0] ?? null;
}
