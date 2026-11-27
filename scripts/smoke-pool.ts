// Scratch-DB check: plays ordering + pool rebuild semantics. PGLITE_DIR must be under /tmp.
import { getDb, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { getTop, refreshListening } from "@/lib/listening";
import { ensureRound, getPool, refreshPool, saveBallot } from "@/lib/monthly";

async function main() {
  if (!process.env.PGLITE_DIR?.startsWith("/tmp/")) throw new Error("scratch DB only");
  const db = await getDb();
  const theo = (await db.select().from(schema.users).where(eq(schema.users.handle, "theo")))[0];
  await refreshListening(theo.id, { force: true });
  const top = await getTop(theo.id, "lifetime", 6);
  console.log("lifetime by plays:", top.map((t) => `${t.position}:${t.streams}`).join(" "));
  const sorted = top.every((t, i) => i === 0 || top[i - 1].streams >= t.streams);
  console.log("sorted by plays:", sorted);
  const round = await ensureRound(theo.crewId);
  // plant a stale plays-song nobody ranked, and a stale one somebody ranked
  const pool0 = await getPool(round.id);
  const fake = (await db.select({ id: schema.tracks.id }).from(schema.tracks).limit(40)).map((r) => r.id).filter((id) => !pool0.some((p) => p.track.id === id));
  await db.insert(schema.monthlyPool).values([
    { roundId: round.id, trackId: fake[0], source: "plays", detail: "[]", weight: 3 },
    { roundId: round.id, trackId: fake[1], source: "plays", detail: "[]", weight: 3 },
  ]);
  await saveBallot(round, theo.id, [fake[1]]);
  await refreshPool(round);
  const pool = await getPool(round.id);
  const ids = new Set(pool.map((p) => p.track.id));
  console.log("stale unranked removed:", !ids.has(fake[0]), "| stale ranked kept:", ids.has(fake[1]), "| kept one sinks to bottom:", pool[pool.length - 1].track.id === fake[1]);
  console.log("pool:", pool.map((p) => `${p.track.name.slice(0, 18)}(${p.weight.toFixed(2)})`).join(", "));
  const b = await db.select().from(schema.monthlyBallots).where(and(eq(schema.monthlyBallots.roundId, round.id), eq(schema.monthlyBallots.userId, theo.id)));
  console.log("ballot intact:", b.length === 1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
