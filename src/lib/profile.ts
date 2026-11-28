import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { ListProfile } from "@/db/schema";
import { newToken } from "./ids";

/**
 * A list's identity, apart from its songs: set in stone or not, the rules it's held to,
 * the Spotify playlist it lives in, the public share link and the share-card style.
 */

export const CARD_THEMES = ["marble", "cobalt", "dusk", "sand", "olive"] as const;
export const CARD_LAYOUTS = ["top5", "number1", "wall", "top10"] as const;
export type CardTheme = (typeof CARD_THEMES)[number];
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export const zCard = z.object({
  theme: z.enum(CARD_THEMES).catch("marble"),
  layout: z.enum(CARD_LAYOUTS).catch("top5"),
  /** their own line at the top of the card; empty = "{name}'s All-Timers" */
  headline: z
    .string()
    .max(120)
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, 48))
    .catch(""),
  /** show the rules line on cards that have room for it */
  showRules: z.boolean().catch(true),
});
export type CardStyle = z.infer<typeof zCard>;
export const DEFAULT_CARD: CardStyle = { theme: "marble", layout: "top5", headline: "", showRules: true };

export function cardOf(p: Pick<ListProfile, "card"> | null | undefined): CardStyle {
  if (!p?.card) return DEFAULT_CARD;
  try {
    return zCard.parse({ ...DEFAULT_CARD, ...JSON.parse(p.card) });
  } catch {
    return DEFAULT_CARD;
  }
}

export async function getProfile(userId: string): Promise<ListProfile | null> {
  const db = await getDb();
  return (await db.select().from(schema.listProfiles).where(eq(schema.listProfiles.userId, userId)))[0] ?? null;
}

export async function getProfiles(userIds: string[]) {
  if (!userIds.length) return new Map<string, ListProfile>();
  const db = await getDb();
  const rows = await db.select().from(schema.listProfiles).where(inArray(schema.listProfiles.userId, userIds));
  return new Map(rows.map((r) => [r.userId, r]));
}

type Patch = Partial<Omit<ListProfile, "userId" | "updatedAt">>;

/** Create or update someone's profile row with just the given fields. */
export async function patchProfile(userId: string, patch: Patch) {
  const db = await getDb();
  const values = { ...patch, updatedAt: new Date() };
  await db
    .insert(schema.listProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.listProfiles.userId, set: values });
}

/** The public share token, made on first use. Unguessable; resetting it kills old links. */
export async function ensureShareToken(userId: string) {
  const p = await getProfile(userId);
  if (p?.shareToken) return p.shareToken;
  const token = newToken(12);
  await patchProfile(userId, { shareToken: token });
  return token;
}

export async function resetShareToken(userId: string, on: boolean) {
  await patchProfile(userId, { shareToken: on ? newToken(12) : null });
}

/** Who a public share token belongs to, or null. Tokens are compared exactly (unique index). */
export async function ownerOfShareToken(token: string) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return null;
  const db = await getDb();
  const row = (
    await db
      .select({ user: schema.users, profile: schema.listProfiles })
      .from(schema.listProfiles)
      .innerJoin(schema.users, eq(schema.users.id, schema.listProfiles.userId))
      .where(eq(schema.listProfiles.shareToken, token))
  )[0];
  return row ?? null;
}
