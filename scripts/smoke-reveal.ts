// Integration check against a scratch database: PGLITE_DIR=/tmp/x npm run ... (never the dev DB)
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { connectStatsfm } from "@/lib/listening";
import { ensureRound, getPool, getResults, nominate, refreshPool, revealIfDue, saveBallot, MonthlyError } from "@/lib/monthly";

async function main() {
  if (!process.env.PGLITE_DIR?.startsWith("/tmp/")) throw new Error("set PGLITE_DIR to a scratch copy under /tmp");
  const db = await getDb();
  const users = await db.select().from(schema.users);
  const [a, b, c] = users;
  console.log("connect", (await connectStatsfm(a.id, "martijn")).ok ? "ok" : "already linked to another member (fine: their plays count)");
  const round = await ensureRound(a.crewId, "2026-06");
  await refreshPool(round);
  const pool = await getPool(round.id);
  console.log("june pool", pool.length, pool.map((p) => `${p.track.name} (${p.weight.toFixed(2)})`).slice(0, 5));
  // closed month: writes must be refused
  for (const [name, fn] of [["ballot", () => saveBallot(round, a.id, [pool[0].track.id])], ["nominate", () => nominate(round, a.id, pool[0].track.id)]] as const) {
    try { await fn(); console.log("FAIL:", name, "accepted on a closed month"); } catch (e) { console.log(name, "refused:", e instanceof MonthlyError, (e as Error).message); }
  }
  // simulate ballots cast during October
  const ids = pool.map((p) => p.track.id);
  const votes: [string, string[]][] = [[a.id, [ids[2], ids[0]]], [b.id, [ids[0], ids[1]]], [c.id, [ids[0]]]];
  for (const [u, order] of votes) await db.insert(schema.monthlyBallots).values(order.map((trackId, i) => ({ roundId: round.id, userId: u, trackId, position: i + 1 })));
  // two reveals racing: exactly one should write results
  const [r1, r2] = await Promise.all([revealIfDue(round), revealIfDue(round)]);
  console.log("status", r1.status, r2.status);
  const results = await getResults(round.id);
  console.log("results rows", results.length, "pool", ids.length, "(must match, no duplicates)");
  console.log("top", results.slice(0, 3).map((r) => `${r.position}. ${r.track.name} score=${r.score.toFixed(3)} voters=${r.voters}`));
  const again = await revealIfDue((await db.select().from(schema.monthlyRounds).where(eq(schema.monthlyRounds.id, round.id)))[0]);
  console.log("re-reveal no-op:", (await getResults(round.id)).length === results.length, again.status);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
