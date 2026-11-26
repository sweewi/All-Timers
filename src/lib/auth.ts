import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
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

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, hashToken(token)))
    .limit(1);
  return rows[0]?.user ?? null;
}

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
