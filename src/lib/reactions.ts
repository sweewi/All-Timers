import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { REACTIONS, type ReactionKind } from "@/db/schema";

export type ReactionCounts = Partial<Record<ReactionKind, { n: number; mine: boolean; who: string[] }>>;

export const songTarget = (ownerId: string, trackId: string) => `song:${ownerId}:${trackId}`;
export const movesTarget = (batchId: string) => `moves:${batchId}`;
export const takeTarget = (raterId: string, trackId: string) => `take:${raterId}:${trackId}`;

/** Reaction counts for many targets in one query. */
export async function getReactions(targets: string[], meId: string | null): Promise<Record<string, ReactionCounts>> {
  const out: Record<string, ReactionCounts> = {};
  if (!targets.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ target: schema.reactions.target, kind: schema.reactions.kind, userId: schema.reactions.userId, name: schema.users.name })
    .from(schema.reactions)
    .innerJoin(schema.users, eq(schema.users.id, schema.reactions.userId))
    .where(inArray(schema.reactions.target, [...new Set(targets)]));
  for (const r of rows) {
    if (!REACTIONS.includes(r.kind)) continue;
    const t = (out[r.target] ??= {});
    const k = (t[r.kind] ??= { n: 0, mine: false, who: [] });
    k.n++;
    k.who.push(r.name);
    if (r.userId === meId) k.mine = true;
  }
  return out;
}
