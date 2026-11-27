import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { connectStatsfm, refreshListening, getPlays, getTop, getAccount, fetchMonth, monthKeyOf, getLive } from "@/lib/listening";
import { ensureRound, refreshPool, getPool, saveBallot, nominate } from "@/lib/monthly";

async function main() {
  const db = await getDb();
  const users = await db.select().from(schema.users);
  console.log("users", users.map((u) => u.handle));
  const theo = users.find((u) => u.handle === "theo")!;
  const handle = process.argv[2] ?? "martijn";
  console.log("connect", await connectStatsfm(theo.id, handle));
  const t0 = Date.now();
  await refreshListening(theo.id, { force: true });
  console.log("refresh ms", Date.now() - t0, await getAccount(theo.id));
  const top = await getTop(theo.id, "lifetime", 5);
  console.log("lifetime top", top.map((r) => `${r.position}. ${r.track.name} (${r.streams})`));
  const plays = await getPlays(theo.id, top.map((r) => r.track.id));
  console.log("plays", plays.shown, plays.floor, plays.totals, [...plays.byTrack.values()].slice(0, 3));
  await fetchMonth(theo.id, monthKeyOf());
  const round = await ensureRound(theo.crewId);
  await refreshPool(round);
  const pool = await getPool(round.id);
  console.log("pool", round.month, pool.length, pool.slice(0, 3).map((p) => p.track.name));
  if (pool.length) console.log("ballot saved", await saveBallot(round, theo.id, [pool[1]?.track.id, pool[0].track.id, "bogus"].filter(Boolean) as string[]));
  try { await nominate(round, theo.id, pool[0].track.id); } catch (e) { console.log("dup nominate ->", (e as Error).message); }
  console.log("live", await getLive(theo.crewId));
  // second refresh should be a no-op (cached)
  const t1 = Date.now(); await refreshListening(theo.id); console.log("cached refresh ms", Date.now() - t1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
