import { getDb, schema } from "@/db";
import { connectStatsfm, refreshListening, getPlays, getTop, getAccount } from "@/lib/listening";

async function main() {
  if (!process.env.PGLITE_DIR?.startsWith("/tmp/")) throw new Error("set PGLITE_DIR to a scratch copy under /tmp");
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
  // second refresh should be a no-op (cached)
  const t1 = Date.now(); await refreshListening(theo.id); console.log("cached refresh ms", Date.now() - t1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
