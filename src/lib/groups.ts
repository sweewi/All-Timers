import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MemberRole } from "@/db/schema";

/**
 * Groups are audiences: a person has one list, and belongs to any number of groups.
 * `users.crewId` is only the group they're looking at right now.
 */

/** SQL condition: this users row is a member of the group. Use in place of users.crewId = x. */
export function inGroup(crewId: string) {
  return sql`${schema.users.id} in (select ${schema.memberships.userId} from ${schema.memberships} where ${schema.memberships.crewId} = ${crewId})`;
}

export async function getMembership(userId: string, crewId: string) {
  const db = await getDb();
  return (
    (await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.crewId, crewId))))[0] ??
    null
  );
}

/** Every group this person belongs to, oldest membership first. */
export async function myGroups(userId: string) {
  const db = await getDb();
  return db
    .select({ crew: schema.crews, role: schema.memberships.role, joinedAt: schema.memberships.joinedAt })
    .from(schema.memberships)
    .innerJoin(schema.crews, eq(schema.crews.id, schema.memberships.crewId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.joinedAt));
}

/** Do these two people share at least one group? (who may see whose column, credit whom) */
export async function shareAGroup(a: string, b: string) {
  if (a === b) return true;
  const db = await getDb();
  const rows = await db.execute(
    sql`select 1 from ${schema.memberships} m1 join ${schema.memberships} m2 on m1.crew_id = m2.crew_id where m1.user_id = ${a} and m2.user_id = ${b} limit 1`,
  );
  return (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows).length > 0;
}

export async function addMembership(userId: string, crewId: string, role: MemberRole = "member") {
  const db = await getDb();
  await db.insert(schema.memberships).values({ userId, crewId, role }).onConflictDoNothing();
}

export async function adminCount(crewId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.crewId, crewId), eq(schema.memberships.role, "admin")));
  return rows.length;
}

/** The site's original group: its admins run site-wide things (the Spotify hub). */
export async function isSiteAdmin(userId: string) {
  const db = await getDb();
  const first = (await db.select({ id: schema.crews.id }).from(schema.crews).orderBy(asc(schema.crews.createdAt)).limit(1))[0];
  if (!first) return false;
  return (await getMembership(userId, first.id))?.role === "admin";
}
