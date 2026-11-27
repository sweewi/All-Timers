import "server-only";
import { and, count, eq, isNotNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { getAccount, monthKeyOf } from "./listening";
import { getRound } from "./monthly";
import { inGroup } from "./groups";

/** Where this person is with setup, for the guide's checklist. Cheap counts only. */
export async function guideStatus(user: User) {
  const db = await getDb();
  const [sessions, allTime, onDeck, stories, acct, round, crew, friends] = await Promise.all([
    db.select({ n: count() }).from(schema.sessions).where(eq(schema.sessions.userId, user.id)),
    db.select({ n: count() }).from(schema.listEntries).where(and(eq(schema.listEntries.userId, user.id), eq(schema.listEntries.kind, "all_time"))),
    db.select({ n: count() }).from(schema.listEntries).where(and(eq(schema.listEntries.userId, user.id), eq(schema.listEntries.kind, "on_deck"))),
    db
      .select({ n: count() })
      .from(schema.origins)
      .where(and(eq(schema.origins.userId, user.id), or(isNotNull(schema.origins.love), isNotNull(schema.origins.story), isNotNull(schema.origins.moment)))),
    getAccount(user.id),
    getRound(user.crewId, monthKeyOf()),
    db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)),
    db.select({ n: count() }).from(schema.users).where(inGroup(user.crewId)),
  ]);
  const voted = round
    ? (await db.select({ n: count() }).from(schema.monthlyBallots).where(and(eq(schema.monthlyBallots.roundId, round.id), eq(schema.monthlyBallots.userId, user.id))))[0].n > 0
    : false;
  return {
    name: user.name,
    handle: user.handle,
    crewName: crew[0]?.name ?? "All-Timers",
    inviteCode: crew[0]?.inviteCode ?? "",
    members: friends[0].n,
    devices: sessions[0].n,
    songs: allTime[0].n,
    onDeck: onDeck[0].n,
    stories: stories[0].n,
    statsfm: !!acct && acct.status !== "gone",
    voted,
  };
}
export type GuideStatus = Awaited<ReturnType<typeof guideStatus>>;
