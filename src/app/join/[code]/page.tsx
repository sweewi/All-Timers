import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { joinCrew } from "@/app/actions";
import { Altitude } from "@/components/World";

export default async function JoinPage({ params, searchParams }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const sp = await searchParams;
  const fromOrigin = typeof sp.from === "string" ? sp.from : "";
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.inviteCode, code)))[0];
  if (!crew) notFound();
  const user = await getCurrentUser();
  if (user) redirect("/");
  const members = await db.select().from(schema.users).where(eq(schema.users.crewId, crew.id));

  // If they were invited from someone's origin story, show the song that brought them here.
  let invitedBy: { name: string; track: string } | null = null;
  if (fromOrigin) {
    const row = (
      await db
        .select({ name: schema.users.name, track: schema.tracks.name })
        .from(schema.origins)
        .innerJoin(schema.users, eq(schema.users.id, schema.origins.userId))
        .innerJoin(schema.tracks, eq(schema.tracks.id, schema.origins.trackId))
        .where(eq(schema.origins.id, fromOrigin))
    )[0];
    if (row) invitedBy = row;
  }

  return (
    <div className="join-page mx-auto max-w-md py-2">
      <Altitude base={0} range={0.06} />
      <p className="text-sm uppercase tracking-widest text-muted">You&apos;re invited to</p>
      <h1 className="rank-num mt-1 text-5xl">{crew.name}</h1>
      {members.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          {members.map((m) => (
            <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
              <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
              {m.name}
            </span>
          ))}
          <span>{members.length === 1 ? "is" : "are"} already here</span>
        </div>
      )}
      {invitedBy && (
        <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
          <b>{invitedBy.name}</b> says you put them on to <b>{invitedBy.track}</b>. Join and you&apos;ll get the credit.
        </p>
      )}
      <form action={joinCrew} className="mt-8 space-y-4">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="fromOrigin" value={fromOrigin} />
        <label className="block">
          <span className="text-sm">What should everyone call you?</span>
          <input
            name="name"
            required
            autoFocus
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        <button className="rounded-full bg-accent px-5 py-2 font-medium text-black">Join</button>
        <p className="text-xs text-muted">No password. This device stays signed in; you can add other devices from Settings.</p>
      </form>
    </div>
  );
}
