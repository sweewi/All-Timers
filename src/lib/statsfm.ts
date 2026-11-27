import "server-only";
import { z } from "zod";
import { coolDown, hostCoolingDown, NetError, safeFetchJson } from "./net";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * A small, polite client for stats.fm. stats.fm has no public developer program, so
 * we behave like a careful guest of the same endpoints its own apps use:
 *  - only read data for usernames our members gave us themselves
 *  - respect each person's stats.fm privacy settings
 *  - at most two requests in flight and a short gap between requests
 *  - long caches (see listening.ts), and a shared cooldown when stats.fm says slow down
 *  - every response validated before use
 */

const BASE = "https://api.stats.fm/api/v1";
const HOST = "api.stats.fm";
const COOLDOWN_KEY = "statsfm_cooldown_until";

// ---------------------------------------------------------------------------- shapes

const Privacy = z
  .object({
    profile: z.boolean().optional(),
    currentlyPlaying: z.boolean().optional(),
    recentlyPlayed: z.boolean().optional(),
    topTracks: z.boolean().optional(),
    streams: z.boolean().optional(),
    streamStats: z.boolean().optional(),
  })
  .partial()
  .passthrough();
export type StatsfmPrivacy = z.infer<typeof Privacy>;

const UserSchema = z.object({
  item: z.object({
    id: z.string().min(1).max(80),
    customId: z.string().max(80).nullish(),
    displayName: z.string().max(200),
    image: z.string().url().nullish(),
    isPlus: z.boolean().optional().default(false),
    privacySettings: Privacy.nullish(),
    syncEnabled: z.boolean().nullish(),
    hasImported: z.boolean().nullish(),
    spotifyAuth: z.object({ sync: z.boolean().nullish(), imported: z.boolean().nullish() }).partial().nullish(),
  }),
});

const TrackSchema = z.object({
  id: z.number().int(),
  name: z.string().max(500),
  durationMs: z.number().int().nonnegative().nullish(),
  artists: z.array(z.object({ id: z.number().int().optional(), name: z.string().max(300) })).default([]),
  albums: z.array(z.object({ name: z.string().max(500).nullish(), image: z.string().nullish() })).default([]),
  externalIds: z.object({ spotify: z.array(z.string()).nullish() }).partial().nullish(),
});
export type StatsfmTrack = z.infer<typeof TrackSchema>;

const TopTracksSchema = z.object({
  items: z.array(
    z.object({
      position: z.number().int(),
      streams: z.number().int().nullish(),
      playedMs: z.number().nullish(),
      track: TrackSchema,
    }),
  ),
});

const StreamStatsSchema = z.object({
  items: z.object({
    durationMs: z.number().nullish(),
    count: z.number().int().nullish(),
    cardinality: z.object({ tracks: z.number().int().nullish() }).partial().nullish(),
  }),
});

const CurrentSchema = z.object({
  item: z
    .object({
      isPlaying: z.boolean().nullish(),
      progressMs: z.number().nullish(),
      track: TrackSchema,
    })
    .passthrough()
    .nullable(),
});

// ---------------------------------------------------------------------------- input

/**
 * Accept what people paste: "will", "@will", "stats.fm/will", "https://stats.fm/user/will",
 * "https://stats.fm/will/tracks". Returns a safe identifier or null.
 */
export function parseStatsfmHandle(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  const m = s.match(/stats\.fm\/(?:user\/)?([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9._-]{1,64}$/.test(s) ? s : null;
}

/** The Spotify track ID stats.fm knows for a track, if any (Apple-only tracks have none). */
export function spotifyIdOf(t: StatsfmTrack): string | null {
  const id = t.externalIds?.spotify?.find((x) => /^[A-Za-z0-9]{22}$/.test(x));
  return id ?? null;
}

// ---------------------------------------------------------------------------- politeness

let inFlight = 0;
let lastStart = 0;
const waiters: (() => void)[] = [];
const MAX_IN_FLIGHT = 2;
const MIN_GAP_MS = 150;

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const wait = lastStart + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart = Date.now();
  try {
    return await fn();
  } finally {
    inFlight--;
    waiters.shift()?.();
  }
}

let cooldownCheckedAt = 0;
/** The shared cooldown lives in the DB so every server instance honours it. */
async function checkSharedCooldown() {
  if (Date.now() - cooldownCheckedAt < 15_000) return;
  cooldownCheckedAt = Date.now();
  const db = await getDb();
  const row = (await db.select().from(schema.settings).where(eq(schema.settings.key, COOLDOWN_KEY)))[0];
  const until = row ? Number(row.value) : 0;
  if (until > Date.now()) coolDown(HOST, until - Date.now());
}

async function setSharedCooldown(ms: number) {
  coolDown(HOST, ms);
  const db = await getDb();
  const value = String(Date.now() + ms);
  await db
    .insert(schema.settings)
    .values({ key: COOLDOWN_KEY, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

export class StatsfmUnavailable extends Error {
  constructor(message = "stats.fm is not answering right now") {
    super(message);
    this.name = "StatsfmUnavailable";
  }
}

async function get<T>(path: string, shape: z.ZodType<T>, okStatuses: number[] = []) {
  await checkSharedCooldown();
  if (hostCoolingDown(HOST)) throw new StatsfmUnavailable();
  try {
    return await slot(() => safeFetchJson(`${BASE}${path}`, shape, { timeoutMs: 10_000, retries: 1, maxBytes: 4_000_000, okStatuses }));
  } catch (e) {
    if (e instanceof NetError && e.status === 429) {
      await setSharedCooldown(e.retryAfterMs ?? 5 * 60_000);
      throw new StatsfmUnavailable("stats.fm asked us to slow down");
    }
    throw e;
  }
}

const enc = (id: string) => {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new Error("bad stats.fm id");
  return encodeURIComponent(id);
};

// ---------------------------------------------------------------------------- endpoints

export type StatsfmProfile = {
  id: string;
  customId: string | null;
  displayName: string;
  image: string | null;
  isPlus: boolean;
  privacy: StatsfmPrivacy;
  /** is stats.fm continuously syncing their Spotify? */
  syncing: boolean | null;
  imported: boolean | null;
};

/** Look a user up by handle or id. null if stats.fm has no such user. */
export async function getProfile(handle: string): Promise<StatsfmProfile | null> {
  const Answer = z.union([UserSchema, z.object({ status: z.literal(404) }).passthrough()]);
  const { status, data } = await get(`/users/${enc(handle)}`, Answer, [404]);
  if (status === 404) return null;
  const parsed = UserSchema.safeParse(data);
  if (!parsed.success) return null;
  const u = parsed.data.item;
  return {
    id: u.id,
    customId: u.customId ?? null,
    displayName: u.displayName || u.customId || u.id,
    image: u.image ?? null,
    isPlus: u.isPlus ?? false,
    privacy: u.privacySettings ?? {},
    syncing: u.spotifyAuth?.sync ?? u.syncEnabled ?? null,
    imported: u.spotifyAuth?.imported ?? u.hasImported ?? null,
  };
}

export type Range = "weeks" | "months" | "lifetime";
export type TopTrack = { position: number; streams: number | null; playedMs: number | null; track: StatsfmTrack };

/** Top tracks for a rolling range, or an exact window ({ after, before } in ms). */
export async function getTopTracks(id: string, when: Range | { after: number; before: number }, limit = 50, offset = 0): Promise<TopTrack[]> {
  const q = new URLSearchParams({ limit: String(Math.min(500, Math.max(1, limit))), offset: String(Math.max(0, offset)) });
  if (typeof when === "string") q.set("range", when);
  else {
    q.set("after", String(Math.floor(when.after)));
    q.set("before", String(Math.floor(when.before)));
  }
  const { data } = await get(`/users/${enc(id)}/top/tracks?${q}`, TopTracksSchema);
  return data.items.map((i) => ({ position: i.position, streams: i.streams ?? null, playedMs: i.playedMs ?? null, track: i.track }));
}

export async function getLifetimeTotals(id: string, range: "lifetime" | "weeks" = "lifetime") {
  const { data } = await get(`/users/${enc(id)}/streams/stats?range=${range}`, StreamStatsSchema);
  return {
    streams: data.items.count ?? null,
    ms: data.items.durationMs ?? null,
    uniqueTracks: data.items.cardinality?.tracks ?? null,
  };
}

export async function getCurrentlyPlaying(id: string) {
  const { data } = await get(`/users/${enc(id)}/streams/current`, CurrentSchema);
  return data.item;
}
