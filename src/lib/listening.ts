import "server-only";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { StatsfmAccount, Track } from "@/db/schema";
import { songKey } from "./songs";
import {
  getCurrentlyPlaying,
  getLifetimeTotals,
  getProfile,
  getTopTracks,
  parseStatsfmHandle,
  spotifyIdOf,
  StatsfmUnavailable,
  type StatsfmPrivacy,
  type StatsfmTrack,
  type TopTrack,
} from "./statsfm";
import { NetError } from "./net";
import { inGroup } from "./groups";

/**
 * Listening data from stats.fm, cached in our database.
 *
 * Nothing on a page waits on stats.fm: pages read the cache, and stale entries are
 * refreshed after the response (or by the daily cron). How stale is stale:
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const TTL: Record<string, number> = {
  profile: 24 * HOUR,
  lifetime: 24 * HOUR,
  months: 12 * HOUR,
  weeks: 4 * HOUR,
  month: 3 * HOUR, // the current calendar month
  now: 50_000,
};
/** Lifetime ranks fetched this deep: almost every song on an all-time list is in here. */
const LIFETIME_DEPTH = 1000;

// ---------------------------------------------------------------------------- time

/** The app's clock for months and reveals. */
export const APP_TZ = process.env.APP_TIMEZONE || "America/New_York";

function tzOffsetMs(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(ms / 1000) * 1000;
}

/** UTC ms of local midnight on the 1st of (year, month) in the app's timezone. */
export function monthStart(year: number, month: number, tz = APP_TZ) {
  const guess = Date.UTC(year, month - 1, 1);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** "YYYY-MM" for a moment, in the app's timezone. */
export function monthKeyOf(ms = Date.now(), tz = APP_TZ) {
  const local = ms + tzOffsetMs(ms, tz);
  const d = new Date(local);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthWindow(key: string, tz = APP_TZ) {
  const [y, m] = key.split("-").map(Number);
  const after = monthStart(y, m, tz);
  const before = m === 12 ? monthStart(y + 1, 1, tz) : monthStart(y, m + 1, tz);
  return { after, before };
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------- accounts

export type ConnectResult =
  | { ok: true; account: StatsfmAccount }
  | { ok: false; reason: "bad-handle" | "not-found" | "taken" | "unavailable"; message: string };

function privacyOf(a: Pick<StatsfmAccount, "privacy">): StatsfmPrivacy {
  try {
    return JSON.parse(a.privacy) as StatsfmPrivacy;
  } catch {
    return {};
  }
}

/** What a viewer may see of this person's listening, given both sets of switches. */
export function visibility(a: StatsfmAccount | null | undefined) {
  if (!a || a.status === "gone") return { plays: false, live: false, tops: false, totals: false };
  const p = privacyOf(a);
  const tops = p.topTracks !== false;
  return {
    tops,
    plays: a.showPlays && tops,
    live: a.showLive && p.currentlyPlaying !== false,
    totals: p.streamStats !== false,
  };
}

export async function connectStatsfm(userId: string, input: string): Promise<ConnectResult> {
  const handle = parseStatsfmHandle(input);
  if (!handle) return { ok: false, reason: "bad-handle", message: "That doesn't look like a stats.fm username or profile link." };
  let profile;
  try {
    profile = await getProfile(handle);
  } catch (e) {
    console.error("statsfm connect", { handle, err: String(e) });
    return { ok: false, reason: "unavailable", message: "stats.fm isn't answering right now. Try again in a minute." };
  }
  if (!profile) return { ok: false, reason: "not-found", message: `No stats.fm account called "${handle}". Check the spelling, or paste your profile link.` };
  const db = await getDb();
  const taken = (await db.select().from(schema.statsfmAccounts).where(eq(schema.statsfmAccounts.statsfmId, profile.id)))[0];
  if (taken && taken.userId !== userId) {
    return { ok: false, reason: "taken", message: "Someone here already connected that stats.fm account." };
  }
  const row = {
    userId,
    statsfmId: profile.id,
    customId: profile.customId,
    displayName: profile.displayName.slice(0, 200),
    imageUrl: profile.image,
    isPlus: profile.isPlus,
    privacy: JSON.stringify(profile.privacy),
    syncing: profile.syncing,
    imported: profile.imported,
    status: "ok" as const,
    lastError: null,
    checkedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    // a different stats.fm account than before: old numbers are not theirs anymore
    const prev = (await tx.select().from(schema.statsfmAccounts).where(eq(schema.statsfmAccounts.userId, userId)))[0];
    if (prev && prev.statsfmId !== profile.id) await clearListening(tx, userId);
    await tx
      .insert(schema.statsfmAccounts)
      .values({ ...row, connectedAt: new Date() })
      .onConflictDoUpdate({ target: schema.statsfmAccounts.userId, set: row });
  });
  const account = (await db.select().from(schema.statsfmAccounts).where(eq(schema.statsfmAccounts.userId, userId)))[0];
  return { ok: true, account };
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function clearListening(tx: Tx, userId: string) {
  await tx.delete(schema.listenTops).where(eq(schema.listenTops.userId, userId));
  await tx.delete(schema.listenSyncs).where(eq(schema.listenSyncs.userId, userId));
  await tx.delete(schema.nowPlaying).where(eq(schema.nowPlaying.userId, userId));
}

/** Forget everything we hold from stats.fm for this person. */
export async function disconnectStatsfm(userId: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await clearListening(tx, userId);
    await tx.delete(schema.statsfmAccounts).where(eq(schema.statsfmAccounts.userId, userId));
  });
}

export async function setSwitches(userId: string, sw: { showLive?: boolean; showPlays?: boolean }) {
  const db = await getDb();
  const set: Partial<StatsfmAccount> = {};
  if (typeof sw.showLive === "boolean") set.showLive = sw.showLive;
  if (typeof sw.showPlays === "boolean") set.showPlays = sw.showPlays;
  if (Object.keys(set).length) await db.update(schema.statsfmAccounts).set(set).where(eq(schema.statsfmAccounts.userId, userId));
  if (sw.showLive === false) await db.delete(schema.nowPlaying).where(eq(schema.nowPlaying.userId, userId));
}

export async function getAccount(userId: string) {
  const db = await getDb();
  return (await db.select().from(schema.statsfmAccounts).where(eq(schema.statsfmAccounts.userId, userId)))[0] ?? null;
}

export async function getAccounts(userIds: string[]) {
  if (!userIds.length) return new Map<string, StatsfmAccount>();
  const db = await getDb();
  const rows = await db.select().from(schema.statsfmAccounts).where(inArray(schema.statsfmAccounts.userId, userIds));
  return new Map(rows.map((r) => [r.userId, r]));
}

// ---------------------------------------------------------------------------- tracks

/**
 * stats.fm tracks carry Spotify IDs, names, artists and art: enough to show them.
 * Save the ones we have never seen; never overwrite better details we already have.
 */
async function upsertTracks(items: StatsfmTrack[]) {
  const rows = new Map<string, typeof schema.tracks.$inferInsert>();
  for (const t of items) {
    const id = spotifyIdOf(t);
    if (!id || rows.has(id)) continue;
    const artists = t.artists.map((a) => a.name).filter(Boolean);
    const img = t.albums.find((a) => a.image)?.image ?? null;
    rows.set(id, {
      id,
      name: t.name.slice(0, 500),
      artists: JSON.stringify(artists),
      album: (t.albums[0]?.name ?? "").slice(0, 500),
      imageUrl: img && /^https:\/\//.test(img) ? img : null,
      durationMs: t.durationMs ?? null,
      songKey: songKey(t.name, artists),
      metaSource: "statsfm",
      fetchedAt: new Date(),
    });
  }
  if (!rows.size) return;
  const db = await getDb();
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += 200) {
    await db.insert(schema.tracks).values(values.slice(i, i + 200)).onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------- refresh

type Period = "lifetime" | "months" | "weeks" | `m:${string}`;

/** truncated: the list was cut at the depth we asked for, so unlisted songs may still have a few plays */
async function storeTop(userId: string, period: Period, items: TopTrack[], truncated = true) {
  await upsertTracks(items.map((i) => i.track));
  const db = await getDb();
  // stats.fm orders by minutes listened; "most played" here means play count, so re-rank
  // by plays (ties keep stats.fm's order) and number from 1 over the songs we can show
  const seen = new Set<string>();
  const rows: (typeof schema.listenTops.$inferInsert)[] = [];
  // (free stats.fm accounts get no counts for rolling ranges: then stats.fm's own order stands)
  const byPlays = items.map((i, idx) => ({ i, idx })).sort((a, b) => (b.i.streams ?? -1) - (a.i.streams ?? -1) || a.idx - b.idx);
  for (const { i } of byPlays) {
    const id = spotifyIdOf(i.track);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ userId, period, trackId: id, position: rows.length + 1, streams: i.streams, playedMs: i.playedMs ?? null });
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.listenTops).where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.period, period)));
    for (let i = 0; i < rows.length; i += 250) await tx.insert(schema.listenTops).values(rows.slice(i, i + 250));
    // past the fetched depth, a song most likely has fewer plays than the least-played one we saw
    const counts = items.map((i) => i.streams).filter((n): n is number => n != null);
    const least = counts.length ? Math.min(...counts) : null;
    const sync = { fetchedAt: new Date(), rows: rows.length, floor: truncated ? least : 0 };
    await tx
      .insert(schema.listenSyncs)
      .values({ userId, period, ...sync })
      .onConflictDoUpdate({ target: [schema.listenSyncs.userId, schema.listenSyncs.period], set: sync });
  });
}

async function markError(userId: string, err: unknown) {
  const db = await getDb();
  const gone = err instanceof NetError && err.status === 404;
  await db
    .update(schema.statsfmAccounts)
    .set({ status: gone ? "gone" : "error", lastError: String(err instanceof Error ? err.message : err).slice(0, 300), checkedAt: new Date() })
    .where(eq(schema.statsfmAccounts.userId, userId));
}

/**
 * Bring one person's cached listening up to date. Only stale pieces are fetched.
 * Never throws: a failure is recorded on the account and retried next time.
 */
export async function refreshListening(userId: string, opts: { force?: boolean; only?: ("profile" | Period | "month")[] } = {}) {
  const db = await getDb();
  const acct = await getAccount(userId);
  if (!acct || acct.status === "gone") return { refreshed: [] as string[] };
  const syncs = await db.select().from(schema.listenSyncs).where(eq(schema.listenSyncs.userId, userId));
  const fetchedAt = new Map(syncs.map((s) => [s.period, s.fetchedAt.getTime()]));
  const now = Date.now();
  const stale = (period: string, ttl: number) => opts.force || now - (fetchedAt.get(period) ?? 0) > ttl;
  const want = (k: "profile" | Period | "month") => !opts.only || opts.only.includes(k);
  const refreshed: string[] = [];
  const month = `m:${monthKeyOf()}` as Period;
  try {
    if (want("profile") && (opts.force || now - acct.checkedAt.getTime() > TTL.profile)) {
      const p = await getProfile(acct.statsfmId);
      if (!p) throw new NetError("stats.fm user not found", 404, "api.stats.fm");
      const totals = p.privacy.streamStats === false ? null : await getLifetimeTotals(acct.statsfmId).catch(() => null);
      const recent = p.privacy.streamStats === false ? null : await getLifetimeTotals(acct.statsfmId, "weeks").catch(() => null);
      await db
        .update(schema.statsfmAccounts)
        .set({
          customId: p.customId,
          displayName: p.displayName.slice(0, 200),
          imageUrl: p.image,
          isPlus: p.isPlus,
          privacy: JSON.stringify(p.privacy),
          syncing: p.syncing,
          imported: p.imported,
          recentStreams: recent?.streams ?? null,
          recentTracks: recent?.uniqueTracks ?? null,
          lifetimeStreams: totals?.streams ?? null,
          lifetimeMs: totals?.ms ?? null,
          uniqueTracks: totals?.uniqueTracks ?? null,
          status: "ok",
          lastError: null,
          checkedAt: new Date(),
        })
        .where(eq(schema.statsfmAccounts.userId, userId));
      acct.privacy = JSON.stringify(p.privacy);
      refreshed.push("profile");
    }
    if (privacyOf(acct).topTracks === false) return { refreshed };
    if (want("lifetime") && stale("lifetime", TTL.lifetime)) {
      const items: TopTrack[] = [];
      for (let offset = 0; offset < LIFETIME_DEPTH; offset += 500) {
        const page = await getTopTracks(acct.statsfmId, "lifetime", 500, offset);
        items.push(...page);
        if (page.length < 500) break;
      }
      await storeTop(userId, "lifetime", items, items.length >= LIFETIME_DEPTH);
      refreshed.push("lifetime");
    }
    if (want("months") && stale("months", TTL.months)) {
      await storeTop(userId, "months", await getTopTracks(acct.statsfmId, "months", 100));
      refreshed.push("months");
    }
    if (want("weeks") && stale("weeks", TTL.weeks)) {
      await storeTop(userId, "weeks", await getTopTracks(acct.statsfmId, "weeks", 50));
      refreshed.push("weeks");
    }
    if (want("month") && stale(month, TTL.month)) {
      await storeTop(userId, month, await getTopTracks(acct.statsfmId, monthWindow(month.slice(2)), 50));
      refreshed.push(month);
    }
  } catch (e) {
    if (!(e instanceof StatsfmUnavailable)) {
      console.error("statsfm refresh", { userId, err: String(e) });
      await markError(userId, e);
    }
  }
  return { refreshed };
}

/** Refresh everyone in a crew, one person at a time (polite), for the cron or after a page. */
export async function refreshCrew(crewId: string, opts: { only?: ("profile" | Period | "month")[] } = {}) {
  const db = await getDb();
  const members = await db
    .select({ userId: schema.statsfmAccounts.userId })
    .from(schema.statsfmAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.statsfmAccounts.userId))
    .where(inGroup(crewId));
  for (const m of members) await refreshListening(m.userId, opts);
  return members.length;
}

/** Fetch a past calendar month for someone (used to build a round after the fact). */
export async function fetchMonth(userId: string, key: string) {
  const acct = await getAccount(userId);
  if (!acct || !visibility(acct).tops) return;
  const period = `m:${key}` as Period;
  const db = await getDb();
  const sync = (await db.select().from(schema.listenSyncs).where(and(eq(schema.listenSyncs.userId, userId), eq(schema.listenSyncs.period, period))))[0];
  const { before } = monthWindow(key);
  // a finished month stops changing a few days after it ends
  const settled = sync && sync.fetchedAt.getTime() > before + 3 * 86_400_000;
  if (settled || (sync && Date.now() - sync.fetchedAt.getTime() < TTL.month)) return;
  try {
    await storeTop(userId, period, await getTopTracks(acct.statsfmId, monthWindow(key), 50));
  } catch (e) {
    if (!(e instanceof StatsfmUnavailable)) console.error("statsfm month", { userId, key, err: String(e) });
  }
}

// ---------------------------------------------------------------------------- reads

/** streams null: stats.fm gave a rank but no count (free accounts) */
export type Plays = { streams: number | null; rank: number };

/**
 * Lifetime play counts for these songs. Songs past the depth we fetched get
 * `{ under: floor }` meaning "fewer than this many plays".
 */
export async function getPlays(userId: string, trackIds: string[]) {
  const acct = await getAccount(userId);
  const vis = visibility(acct);
  const out = { shown: vis.plays, byTrack: new Map<string, Plays>(), floor: null as number | null, totals: null as null | { streams: number | null; hours: number | null; unique: number | null } };
  if (!acct) return out;
  if (vis.totals && acct.lifetimeStreams != null) {
    out.totals = { streams: acct.lifetimeStreams, hours: acct.lifetimeMs ? Math.round(Number(acct.lifetimeMs) / 3_600_000) : null, unique: acct.uniqueTracks };
  }
  if (!vis.plays || !trackIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ trackId: schema.listenTops.trackId, streams: schema.listenTops.streams, position: schema.listenTops.position })
    .from(schema.listenTops)
    .where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.period, "lifetime"), inArray(schema.listenTops.trackId, trackIds)));
  for (const r of rows) out.byTrack.set(r.trackId, { streams: r.streams, rank: r.position });
  // A list often holds one version (the remaster, the single) while the plays went to another.
  // Match the rest by normalized title + artists, taking that song's most-played version.
  const missing = trackIds.filter((id) => !out.byTrack.has(id));
  if (missing.length) {
    const keys = await db.select({ id: schema.tracks.id, key: schema.tracks.songKey }).from(schema.tracks).where(inArray(schema.tracks.id, missing));
    const want = new Map(keys.filter((k) => k.key).map((k) => [k.key!, k.id]));
    if (want.size) {
      const alt = await db
        .select({ key: schema.tracks.songKey, streams: schema.listenTops.streams, position: schema.listenTops.position })
        .from(schema.listenTops)
        .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listenTops.trackId))
        .where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.period, "lifetime"), inArray(schema.tracks.songKey, [...want.keys()])));
      for (const a of alt) {
        const id = a.key ? want.get(a.key) : undefined;
        if (!id) continue;
        const cur = out.byTrack.get(id);
        if (!cur || a.position < cur.rank) out.byTrack.set(id, { streams: a.streams, rank: a.position });
      }
    }
  }
  const sync = (await db.select().from(schema.listenSyncs).where(and(eq(schema.listenSyncs.userId, userId), eq(schema.listenSyncs.period, "lifetime"))))[0];
  out.floor = sync?.floor ?? null;
  return out;
}

/** Someone's top songs for a period (empty if they hide it). */
export async function getTop(userId: string, period: Period, limit = 20) {
  const acct = await getAccount(userId);
  if (!visibility(acct).tops) return [];
  const db = await getDb();
  return db
    .select({ position: schema.listenTops.position, streams: schema.listenTops.streams, track: schema.tracks })
    .from(schema.listenTops)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listenTops.trackId))
    .where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.period, period)))
    .orderBy(asc(schema.listenTops.position))
    .limit(limit);
}

export type Live = { userId: string; track: Track | null; isPlaying: boolean; fetchedAt: Date };

/**
 * What the crew is playing right now. Reads the cache; refreshes members whose entry
 * is older than a minute (at most `budget` of them per call, so a page never fans out).
 */
export async function getLive(crewId: string, budget = 4): Promise<Live[]> {
  const db = await getDb();
  const accts = await db
    .select({ a: schema.statsfmAccounts })
    .from(schema.statsfmAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.statsfmAccounts.userId))
    .where(inGroup(crewId));
  const visible = accts.map((r) => r.a).filter((a) => visibility(a).live);
  if (!visible.length) return [];
  const cached = await db.select().from(schema.nowPlaying).where(inArray(schema.nowPlaying.userId, visible.map((a) => a.userId)));
  const byUser = new Map(cached.map((c) => [c.userId, c]));
  const stale = budget > 0 ? visible.filter((a) => Date.now() - (byUser.get(a.userId)?.fetchedAt.getTime() ?? 0) > TTL.now).slice(0, budget) : [];
  await Promise.all(
    stale.map(async (a) => {
      try {
        const cur = await getCurrentlyPlaying(a.statsfmId);
        const id = cur ? spotifyIdOf(cur.track) : null;
        if (cur && id) await upsertTracks([cur.track]);
        const row = { trackId: id, isPlaying: !!cur && cur.isPlaying !== false && !!id, progressMs: cur?.progressMs ?? null, fetchedAt: new Date() };
        await db.insert(schema.nowPlaying).values({ userId: a.userId, ...row }).onConflictDoUpdate({ target: schema.nowPlaying.userId, set: row });
        byUser.set(a.userId, { userId: a.userId, ...row });
      } catch (e) {
        if (!(e instanceof StatsfmUnavailable)) console.error("statsfm live", { userId: a.userId, err: String(e) });
      }
    }),
  );
  const trackIds = [...byUser.values()].map((c) => c.trackId).filter((x): x is string => !!x);
  const tracks = trackIds.length ? await db.select().from(schema.tracks).where(inArray(schema.tracks.id, trackIds)) : [];
  const t = new Map(tracks.map((x) => [x.id, x]));
  return visible.map((a) => {
    const c = byUser.get(a.userId);
    return { userId: a.userId, track: c?.trackId ? (t.get(c.trackId) ?? null) : null, isPlaying: !!c?.isPlaying, fetchedAt: c?.fetchedAt ?? new Date(0) };
  });
}

/** Members whose listening is stale enough to be worth a refresh after this page. */
export async function staleMembers(crewId: string, limit = 2) {
  const db = await getDb();
  const rows = await db
    .select({ userId: schema.statsfmAccounts.userId, checkedAt: schema.statsfmAccounts.checkedAt })
    .from(schema.statsfmAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.statsfmAccounts.userId))
    .where(and(inGroup(crewId), eq(schema.statsfmAccounts.status, "ok")));
  const syncs = rows.length
    ? await db
        .select()
        .from(schema.listenSyncs)
        .where(and(inArray(schema.listenSyncs.userId, rows.map((r) => r.userId)), eq(schema.listenSyncs.period, "weeks")))
    : [];
  const at = new Map(syncs.map((s) => [s.userId, s.fetchedAt.getTime()]));
  return rows
    .filter((r) => Date.now() - (at.get(r.userId) ?? 0) > TTL.weeks)
    .sort((a, b) => (at.get(a.userId) ?? 0) - (at.get(b.userId) ?? 0))
    .slice(0, limit)
    .map((r) => r.userId);
}

/** Sweep cached months older than a year (privacy: we keep only what we use). */
export async function sweepOldListening() {
  const db = await getDb();
  const cutoff = monthKeyOf(Date.now() - 400 * 86_400_000);
  const old = await db.select({ period: schema.listenSyncs.period, userId: schema.listenSyncs.userId }).from(schema.listenSyncs);
  for (const o of old) {
    if (o.period.startsWith("m:") && o.period.slice(2) < cutoff) {
      await db.delete(schema.listenTops).where(and(eq(schema.listenTops.userId, o.userId), eq(schema.listenTops.period, o.period)));
      await db.delete(schema.listenSyncs).where(and(eq(schema.listenSyncs.userId, o.userId), eq(schema.listenSyncs.period, o.period)));
    }
  }
  await db.delete(schema.nowPlaying).where(lt(schema.nowPlaying.fetchedAt, new Date(Date.now() - 86_400_000)));
}



/** Only what's actually playing, recently confirmed. Safe to send to the browser. */
export async function getLiveNow(crewId: string, budget = 4) {
  const live = await getLive(crewId, budget);
  const fresh = Date.now() - 5 * 60_000;
  const playing = live.filter((l) => l.isPlaying && l.track && l.fetchedAt.getTime() > fresh);
  if (!playing.length) return [];
  const db = await getDb();
  const people = await db
    .select({ id: schema.users.id, handle: schema.users.handle, name: schema.users.name, color: schema.users.color })
    .from(schema.users)
    .where(inArray(schema.users.id, playing.map((l) => l.userId)));
  const who = new Map(people.map((p) => [p.id, p]));
  return playing
    .filter((l) => who.has(l.userId))
    .map((l) => ({
      handle: who.get(l.userId)!.handle,
      name: who.get(l.userId)!.name,
      color: who.get(l.userId)!.color,
      track: { id: l.track!.id, name: l.track!.name, artists: l.track!.artists, imageUrl: l.track!.imageUrl },
    }));
}
export type LiveNow = Awaited<ReturnType<typeof getLiveNow>>[number];

/**
 * Does stats.fm's data for this person show any favorites lately? If the last four
 * weeks hold about as many plays as distinct songs (every song once), "most played"
 * is a coin toss, and we say so instead of pretending.
 */
export function hasRepeats(a: Pick<StatsfmAccount, "recentStreams" | "recentTracks">) {
  if (!a.recentStreams || !a.recentTracks) return true; // unknown: give it the benefit of the doubt
  return a.recentStreams / a.recentTracks >= 1.2;
}

/**
 * On repeat: what each crew member has played most over the last four weeks.
 * Up to `perPerson` songs each, highest plays first, with who's behind them.
 */
export async function heavyRotation(crewId: string, perPerson = 3) {
  const db = await getDb();
  const rows = await db
    .select({ a: schema.statsfmAccounts, user: schema.users })
    .from(schema.statsfmAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.statsfmAccounts.userId))
    .where(inGroup(crewId));
  const out: { user: (typeof rows)[number]["user"]; track: Track; streams: number | null; position: number }[] = [];
  for (const { a, user } of rows) {
    if (!visibility(a).plays || !hasRepeats(a)) continue;
    const top = await db
      .select({ position: schema.listenTops.position, streams: schema.listenTops.streams, track: schema.tracks })
      .from(schema.listenTops)
      .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listenTops.trackId))
      .where(and(eq(schema.listenTops.userId, a.userId), eq(schema.listenTops.period, "weeks")))
      .orderBy(asc(schema.listenTops.position))
      .limit(perPerson);
    for (const t of top) if (t.streams == null || t.streams >= 2) out.push({ user, track: t.track, streams: t.streams, position: t.position });
  }
  // interleave people so one heavy listener doesn't fill the rail
  return out.sort((x, y) => x.position - y.position || (y.streams ?? 0) - (x.streams ?? 0));
}

/**
 * Songs you've been playing a lot lately that aren't on either of your lists yet:
 * the natural candidates for On Deck.
 */
export async function onDeckSuggestions(userId: string, have: Set<string>, limit = 8) {
  const acct = await getAccount(userId);
  // your own suggestions: only stats.fm's own privacy matters, not what you show the crew
  if (!acct || !visibility(acct).tops) return [];
  const db = await getDb();
  const rows = await db
    .select({ period: schema.listenTops.period, position: schema.listenTops.position, streams: schema.listenTops.streams, track: schema.tracks })
    .from(schema.listenTops)
    .innerJoin(schema.tracks, eq(schema.tracks.id, schema.listenTops.trackId))
    .where(and(eq(schema.listenTops.userId, userId), inArray(schema.listenTops.period, ["weeks", "months"])))
    .orderBy(asc(schema.listenTops.position));
  const haveKeys = new Set<string>();
  if (have.size) {
    const ks = await db.select({ key: schema.tracks.songKey }).from(schema.tracks).where(inArray(schema.tracks.id, [...have]));
    for (const k of ks) haveKeys.add(k.key);
  }
  const seen = new Set<string>();
  if (!hasRepeats(acct)) return [];
  const out: { track: Track; streams: number | null; period: string }[] = [];
  // the last four weeks first, then the last six months
  for (const period of ["weeks", "months"]) {
    for (const r of rows.filter((x) => x.period === period)) {
      // "keep playing" means it: a few plays a month, not one stray listen
      // with counts: a few plays at least; without (free stats.fm): near the top of their list
      if (r.streams != null ? r.streams < (period === "weeks" ? 3 : 6) : r.position > (period === "weeks" ? 10 : 15)) continue;
      if (have.has(r.track.id) || haveKeys.has(r.track.songKey) || seen.has(r.track.songKey)) continue;
      seen.add(r.track.songKey);
      out.push({ track: r.track, streams: r.streams, period });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** True if stats.fm shows this person played this exact track (so we may add it to their list). */
export async function hasListened(userId: string, trackId: string) {
  const db = await getDb();
  const r = await db
    .select({ t: schema.listenTops.trackId })
    .from(schema.listenTops)
    .where(and(eq(schema.listenTops.userId, userId), eq(schema.listenTops.trackId, trackId)))
    .limit(1);
  return r.length > 0;
}
