import "server-only";
import type { z } from "zod";

/**
 * The one way this app talks to the outside world.
 *
 * - Only hosts on the allowlist are reachable, so no user input can make the server
 *   fetch an arbitrary URL (SSRF).
 * - Every request has a timeout, a response size cap, and a small, jittered retry
 *   budget for network errors, 429s and 5xx, honouring Retry-After.
 * - A per-host circuit breaker stops hammering a service that is failing: after
 *   repeated failures (or a 429) the host is skipped until its cooldown ends.
 * - JSON is validated against a schema before anyone uses it.
 */

const ALLOWED = new Set([
  "open.spotify.com",
  "api.spotify.com",
  "accounts.spotify.com",
  "api.stats.fm",
]);

export const USER_AGENT = "AllTimers/1.0 (+https://github.com/sweewi/All-Timers; small private friend-group site)";

export class NetError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly host: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "NetError";
  }
}

type Breaker = { failures: number; openUntil: number };
const breakers = new Map<string, Breaker>();
const BREAK_AFTER = 4;
const BREAK_FOR_MS = 60_000;

export function hostCoolingDown(host: string) {
  const b = breakers.get(host);
  return b ? b.openUntil > Date.now() : false;
}

/** Let callers (e.g. a shared cooldown stored in the DB) open the breaker for a host. */
export function coolDown(host: string, ms: number) {
  const b = breakers.get(host) ?? { failures: 0, openUntil: 0 };
  b.openUntil = Math.max(b.openUntil, Date.now() + ms);
  breakers.set(host, b);
}

function recordFailure(host: string, retryAfterMs: number | null) {
  const b = breakers.get(host) ?? { failures: 0, openUntil: 0 };
  b.failures += 1;
  if (retryAfterMs) b.openUntil = Math.max(b.openUntil, Date.now() + retryAfterMs);
  if (b.failures >= BREAK_AFTER) b.openUntil = Math.max(b.openUntil, Date.now() + BREAK_FOR_MS);
  breakers.set(host, b);
}

function recordSuccess(host: string) {
  breakers.delete(host);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.min(60_000, Math.max(0, s * 1000));
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.min(60_000, Math.max(0, t - Date.now())) : null;
}

async function readCapped(res: Response, maxBytes: number) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new NetError("response too large", res.status, new URL(res.url).host);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new NetError("response too large", res.status, new URL(res.url).host);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  maxBytes?: number;
  /** status codes that are answers, not failures (e.g. 404 "no such user") */
  okStatuses?: number[];
};

/** Follow up to 3 redirects by hand, refusing any hop that leaves the allowlist. */
async function fetchFollowingAllowed(start: URL, opts: FetchOpts) {
  let url = start;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 8000);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      method: hop === 0 ? (opts.method ?? "GET") : "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.9", ...opts.headers },
      body: hop === 0 ? opts.body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal,
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    const next = new URL(loc, url);
    if (next.protocol !== "https:" || !ALLOWED.has(next.host)) throw new NetError(`redirect to disallowed host ${next.host}`, res.status, url.host);
    url = next;
  }
  throw new NetError("too many redirects", null, start.host);
}

/** Fetch text from an allowlisted host, with timeout, retries, size cap and breaker. */
export async function safeFetchText(url: string, opts: FetchOpts = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED.has(u.host)) throw new NetError(`host not allowed: ${u.host}`, null, u.host);
  if (hostCoolingDown(u.host)) throw new NetError("host cooling down", null, u.host);
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFollowingAllowed(u, opts);
      if (res.ok || opts.okStatuses?.includes(res.status)) {
        const text = await readCapped(res, opts.maxBytes ?? 3_000_000);
        recordSuccess(u.host);
        return { status: res.status, text, headers: res.headers };
      }
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) throw new NetError(`HTTP ${res.status}`, res.status, u.host);
      recordFailure(u.host, res.status === 429 ? (retryAfter ?? 30_000) : null);
      lastErr = new NetError(`HTTP ${res.status}`, res.status, u.host, retryAfter);
      if (res.status === 429) break; // do not keep knocking; the breaker carries the wait
      await sleep(Math.min(4000, (retryAfter ?? 300 * 2 ** attempt) + Math.random() * 250));
    } catch (e) {
      if (e instanceof NetError && e.status !== null && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      if (!(e instanceof NetError)) recordFailure(u.host, null);
      if (attempt < retries) await sleep(300 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr instanceof Error ? lastErr : new NetError("request failed", null, u.host);
}

/** Fetch JSON and validate it. Throws if the shape is not what we expect. */
export async function safeFetchJson<T>(url: string, schema: z.ZodType<T>, opts: FetchOpts = {}) {
  const { status, text } = await safeFetchText(url, opts);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new NetError("invalid JSON", status, new URL(url).host);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new NetError(`unexpected response shape: ${parsed.error.issues[0]?.path.join(".")}`, status, new URL(url).host);
  return { status, data: parsed.data };
}
