/**
 * Local demo data: a crew of three with overlapping lists, a different-version
 * pair and a couple of put-ons. Uses the embedded database (no DATABASE_URL).
 *   npm run seed            then open the printed sign-in links
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as schema from "../src/db/schema";
import { songKey } from "../src/lib/songs";

if (process.env.DATABASE_URL) {
  console.error("Refusing to seed a real database. Unset DATABASE_URL.");
  process.exit(1);
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const fakeId = (n: number) => `demo${String(n).padStart(18, "0")}`;

const SONGS: [string, string[], string, number, string][] = [
  ["Pink Moon", ["Nick Drake"], "Pink Moon", 1972, "GBAAA7200001"],
  ["Ultralight Beam", ["Kanye West"], "The Life Of Pablo", 2016, "USUM71600001"],
  ["Nights", ["Frank Ocean"], "Blonde", 2016, "USUM71600002"],
  ["Heroes - 2017 Remaster", ["David Bowie"], '"Heroes"', 1977, "GBAAA1700001"],
  ["Heroes", ["David Bowie"], '"Heroes" (Original)', 1977, "GBAAA7700001"],
  ["Redbone", ["Childish Gambino"], "Awaken, My Love!", 2016, "USUM71600003"],
  ["Motion Sickness", ["Phoebe Bridgers"], "Stranger in the Alps", 2017, "USUM71700001"],
  ["Ivy", ["Frank Ocean"], "Blonde", 2016, "USUM71600004"],
  ["Something", ["The Beatles"], "Abbey Road", 1969, "GBAYE6900001"],
  ["Alright", ["Kendrick Lamar"], "To Pimp A Butterfly", 2015, "USUM71500001"],
  ["Holocene", ["Bon Iver"], "Bon Iver", 2011, "USJAG1100001"],
  ["Dreams - 2004 Remaster", ["Fleetwood Mac"], "Rumours", 1977, "USWB10400001"],
  ["Lost in Yesterday", ["Tame Impala"], "The Slow Rush", 2020, "AUUM72000001"],
  ["Earfquake", ["Tyler, The Creator"], "IGOR", 2019, "USSM11900001"],
  ["Re: Stacks", ["Bon Iver"], "For Emma, Forever Ago", 2008, "USJAG0800001"],
];

async function main() {
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  if ((await db.select().from(schema.crews)).length) {
    console.log("Database already has a crew; delete ./.pglite to reseed.");
    return;
  }

  const crewId = randomUUID();
  await db.insert(schema.crews).values({ id: crewId, name: "The Crew", inviteCode: "demo-invite" });

  const people = [
    { name: "Will", color: "#f97316", admin: true },
    { name: "Jack", color: "#22c55e", admin: false },
    { name: "Maya", color: "#3b82f6", admin: false },
  ];
  const users = people.map((p) => ({ id: randomUUID(), crewId, name: p.name, handle: p.name.toLowerCase(), color: p.color, isAdmin: p.admin }));
  await db.insert(schema.users).values(users);

  await db.insert(schema.tracks).values(
    SONGS.map(([name, artists, album, year, isrc], i) => ({
      id: fakeId(i),
      name,
      artists: JSON.stringify(artists),
      album,
      releaseYear: year,
      isrc,
      songKey: songKey(name, artists),
      metaSource: "spotify",
    })),
  );

  const lists: Record<string, number[]> = {
    will: [0, 1, 2, 3, 6, 9, 10, 13],
    jack: [2, 5, 4, 9, 7, 11, 12],
    maya: [6, 0, 14, 8, 1, 11],
  };
  const batch = randomUUID();
  for (const u of users) {
    const ids = lists[u.handle];
    await db.insert(schema.listEntries).values(ids.map((n, i) => ({ userId: u.id, kind: "all_time" as const, trackId: fakeId(n), position: i + 1 })));
    await db.insert(schema.rankEvents).values(
      ids.map((n, i) => ({ id: randomUUID(), batchId: `${batch}-${u.handle}`, userId: u.id, kind: "all_time" as const, trackId: fakeId(n), type: "add" as const, toPos: i + 1 })),
    );
  }
  await db.insert(schema.listEntries).values([
    { userId: users[1].id, kind: "on_deck", trackId: fakeId(0), position: 1 },
    { userId: users[0].id, kind: "on_deck", trackId: fakeId(12), position: 1 },
  ]);

  await db.insert(schema.origins).values([
    { id: randomUUID(), userId: users[0].id, trackId: fakeId(0), fromUserId: users[2].id, whenText: "Fall 2018", whereText: "Her dorm room", story: "She played it on a rainy Sunday and I never recovered." },
    { id: randomUUID(), userId: users[1].id, trackId: fakeId(2), fromName: "My older brother", whenText: "2016", whereText: "His car" },
    { id: randomUUID(), userId: users[2].id, trackId: fakeId(6), fromUserId: users[0].id, whenText: "Summer 2019" },
  ]);

  const links: string[] = [];
  for (const u of users) {
    const token = randomBytes(18).toString("base64url");
    await db.insert(schema.loginLinks).values({ tokenHash: hash(token), userId: u.id, expiresAt: new Date(Date.now() + 864e5) });
    links.push(`${u.name}: http://localhost:3000/signin/${token}`);
  }
  console.log("Seeded. Sign in as:\n" + links.join("\n") + "\nInvite link: http://localhost:3000/join/demo-invite");
}

main().then(() => process.exit(0));
