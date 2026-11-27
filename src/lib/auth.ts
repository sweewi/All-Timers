import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { hashToken, newToken } from "./ids";

const COOKIE = "at_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** No passwords, no email: joining sets a long-lived session cookie on this device. */
export async function startSession(userId: string) {
  const db = await getDb();
  const token = newToken();
  await db.insert(schema.sessions).values({ tokenHash: hashToken(token), userId });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR,
    path: "/",
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
  }
  jar.delete(COOKIE);
}

/**
 * The signed-in person, as seen in the group they're currently looking at:
 * `crewId` is that group and `isAdmin` is their role there. If they've left (or been
 * removed from) that group, they land in another of theirs; with no groups left,
 * they're signed out.
 */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ user: schema.users, role: schema.memberships.role })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .leftJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.crewId, schema.users.crewId)))
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.role) return { ...row.user, isAdmin: row.role === "admin" };
  const other = (
    await db.select().from(schema.memberships).where(eq(schema.memberships.userId, row.user.id)).orderBy(asc(schema.memberships.joinedAt)).limit(1)
  )[0];
  if (!other) return null;
  await db.update(schema.users).set({ crewId: other.crewId }).where(eq(schema.users.id, row.user.id));
  return { ...row.user, crewId: other.crewId, isAdmin: other.role === "admin" };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

/** A link that signs this member in on another device. Valid for 24 hours, single use. */
export async function createLoginLink(userId: string) {
  const db = await getDb();
  const token = newToken();
  await db.insert(schema.loginLinks).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return `/signin/${token}`;
}

export async function redeemLoginLink(token: string) {
  const db = await getDb();
  const hash = hashToken(token);
  const rows = await db
    .select()
    .from(schema.loginLinks)
    .where(and(eq(schema.loginLinks.tokenHash, hash), gt(schema.loginLinks.expiresAt, new Date())))
    .limit(1);
  const link = rows[0];
  if (!link) return null;
  await db.delete(schema.loginLinks).where(eq(schema.loginLinks.tokenHash, hash));
  return link.userId;
}
