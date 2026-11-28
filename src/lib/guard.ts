import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { LIST_KINDS } from "@/db/schema";
import { rateLimit } from "./ratelimit";

/**
 * Every server action is a public POST endpoint: anyone can call it with any
 * arguments, whatever the UI sends. These are the shapes the app accepts.
 */
export const zTrackId = z.string().regex(/^[A-Za-z0-9]{22}$/, "Not a Spotify track id");
export const zId = z.uuid();
export const zKind = z.enum(LIST_KINDS);
export const zTrackIds = z.array(zTrackId).max(500, "Lists top out at 500 songs");
export const zName = z.string().trim().min(1).max(40);
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const zText = (max: number) => z.string().max(max * 2).transform((s) => s.trim().slice(0, max));

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new ActionError("That request didn't look right.");
  return r.data;
}

/** Best-effort client address for rate limits on signed-out actions. Vercel sets x-forwarded-for. */
export async function clientAddress() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "local").slice(0, 64);
}

/**
 * Named budgets, per user (or per address when signed out). Generous enough that
 * a person never notices; tight enough that a script can't hammer stats.fm,
 * Spotify or the database through us.
 */
const BUDGETS = {
  write: [120, 60], // reorder, reactions, steals: 120 a minute
  import: [20, 600], // previews and imports: 20 per 10 minutes (each can hit Spotify)
  statsfm: [10, 3600], // connect / force-refresh: 10 an hour
  share: [30, 3600], // share links made or reset: 30 an hour
  render: [240, 600], // card images drawn per person or address: 240 per 10 minutes
  join: [10, 3600], // new members per address per hour
  link: [10, 3600], // login links minted
} as const satisfies Record<string, readonly [number, number]>;

export async function budget(name: keyof typeof BUDGETS, who: string) {
  const [n, sec] = BUDGETS[name];
  await rateLimit(`${name}:${who}`, n, sec);
}
