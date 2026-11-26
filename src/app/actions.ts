"use server";

import { redirect } from "next/navigation";
import { eq, like } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { startSession, endSession } from "@/lib/auth";
import { newId, newToken, pickColor, slugify } from "@/lib/ids";

async function uniqueHandle(name: string) {
  const db = await getDb();
  const base = slugify(name);
  const taken = new Set(
    (await db.select({ h: schema.users.handle }).from(schema.users).where(like(schema.users.handle, `${base}%`))).map(
      (r) => r.h,
    ),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** First run only: create the crew and its first member (the admin). */
export async function setupCrew(formData: FormData) {
  const db = await getDb();
  const existing = await db.select({ id: schema.crews.id }).from(schema.crews).limit(1);
  if (existing.length) redirect("/");
  const name0 = String(formData.get("name") || "").trim();
  const crewName = String(formData.get("crewName") || "").trim() || (name0 ? `${name0}'s All-Timers` : "All-Timers");
  const name = String(formData.get("name") || "").trim();
  if (!name) redirect("/?error=name");
  const crewId = newId();
  await db.insert(schema.crews).values({ id: crewId, name: crewName, inviteCode: newToken(9) });
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    crewId,
    name,
    handle: await uniqueHandle(name),
    color: pickColor(0),
    isAdmin: true,
  });
  await startSession(userId);
  redirect("/me/import?first=1");
}

/**
 * Join a crew from its invite link. If the link came from someone's origin story
 * ("Jack put me on to this"), the new member is credited on that origin.
 */
export async function joinCrew(formData: FormData) {
  const db = await getDb();
  const code = String(formData.get("code") || "");
  const name = String(formData.get("name") || "").trim();
  const fromOrigin = String(formData.get("fromOrigin") || "");
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.inviteCode, code)))[0];
  if (!crew) redirect("/");
  if (!name) redirect(`/join/${code}?error=name`);
  const count = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.crewId, crew.id)))
    .length;
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    crewId: crew.id,
    name,
    handle: await uniqueHandle(name),
    color: pickColor(count),
  });
  if (fromOrigin) {
    const origin = (await db.select().from(schema.origins).where(eq(schema.origins.id, fromOrigin)))[0];
    if (origin && !origin.fromUserId) {
      const owner = (await db.select().from(schema.users).where(eq(schema.users.id, origin.userId)))[0];
      if (owner?.crewId === crew.id) {
        await db
          .update(schema.origins)
          .set({ fromUserId: userId, fromName: null, foundVia: "friend", updatedAt: new Date() })
          .where(eq(schema.origins.id, origin.id));
      }
    }
  }
  await startSession(userId);
  redirect("/me/import?first=1");
}

export async function signOut() {
  await endSession();
  redirect("/");
}
