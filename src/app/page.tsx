import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getCrewFeed, getCrewOverview, type FeedItem } from "@/lib/lists";
import { Art } from "@/components/track";
import { CopyButton } from "@/components/client";
import { setupCrew } from "./actions";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const [overview, feed] = await Promise.all([getCrewOverview(user.crewId), getCrewFeed(user.crewId)]);
  const mine = overview.find((o) => o.member.id === user.id);

  return (
    <div className="space-y-12">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-widest text-muted">{crew.name}</p>
          <h1 className="rank-num mt-1 text-5xl">Everyone&apos;s all-timers</h1>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <span className="text-sm text-muted">Invite your crew</span>
          <CopyButton text={`/join/${crew.inviteCode}`} label="Copy invite link" />
        </div>
      </section>

      {mine && mine.count === 0 && (
        <Link
          href="/me/import"
          className="block rounded-2xl border border-accent/50 bg-accent/10 p-5 hover:bg-accent/15"
        >
          <div className="font-medium text-accent">Add your all-time list →</div>
          <div className="mt-1 text-sm text-muted">Copy it from Spotify in about a minute. We&apos;ll walk you through it.</div>
        </Link>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {overview.map(({ member, count, top }) => (
          <Link
            key={member.id}
            href={`/u/${member.handle}`}
            className="group rounded-2xl border border-line bg-surface p-5 transition hover:border-foreground/30"
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: member.color }} />
              <span className="font-medium">{member.name}</span>
              <span className="ml-auto text-sm text-muted">{count ? `${count} songs` : "no list yet"}</span>
            </div>
            {top[0] ? (
              <div className="mt-4 flex gap-3">
                <Art track={top[0]} size={64} />
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-muted">#1 all time</div>
                  <div className="truncate font-medium">{top[0].name}</div>
                  <div className="mt-1 truncate text-sm text-muted">
                    {top.slice(1).map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && " · "}#{i + 2} {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 h-16 rounded-lg border border-dashed border-line" />
            )}
          </Link>
        ))}
      </section>

      <section>
        <h2 className="rank-num text-3xl">Latest moves</h2>
        {feed.length === 0 ? (
          <p className="mt-3 text-muted">Nothing yet. Lists, moves and new songs will show up here.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {feed.map((item) => (
              <FeedRow key={item.batchId} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const listName = (k: string) => (k === "on_deck" ? "On Deck" : "All-Time list");

function FeedRow({ item }: { item: FeedItem }) {
  const adds = item.events.filter((e) => e.type === "add");
  const moves = item.events.filter((e) => e.type === "move");
  const removes = item.events.filter((e) => e.type === "remove");
  const name = (
    <Link href={`/u/${item.user.handle}`} className="font-medium" style={{ color: item.user.color }}>
      {item.user.name}
    </Link>
  );
  let text: React.ReactNode;
  if (adds.length > 5) {
    text = (
      <>
        {name} added {adds.length} songs to their {listName(item.kind)}
      </>
    );
  } else {
    // Small edits read best one change at a time; the biggest climbs first.
    const parts: React.ReactNode[] = [];
    for (const a of adds) parts.push(<>added <b>{a.track.name}</b> at #{a.toPos}</>);
    for (const m of [...moves].sort((x, y) => (y.fromPos! - y.toPos!) - (x.fromPos! - x.toPos!)).slice(0, 3)) {
      const up = m.fromPos! > m.toPos!;
      parts.push(
        <>
          moved <b>{m.track.name}</b> {up ? "up" : "down"} #{m.fromPos} → #{m.toPos}
        </>,
      );
    }
    for (const r of removes.slice(0, 2)) parts.push(<>dropped <b>{r.track.name}</b></>);
    text = (
      <>
        {name}{" "}
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && (i === parts.length - 1 ? " and " : ", ")}
            {p}
          </span>
        ))}
        {item.kind === "on_deck" && <span className="text-muted"> (On Deck)</span>}
      </>
    );
  }
  return (
    <li className="flex items-center gap-3 py-3 text-sm">
      <Art track={item.events[0].track} size={36} />
      <div className="flex-1">{text}</div>
      <time className="shrink-0 text-xs text-muted">{timeAgo(item.createdAt)}</time>
    </li>
  );
}

function timeAgo(d: Date) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function SignedOut() {
  const db = await getDb();
  const anyCrew = (await db.select({ id: schema.crews.id }).from(schema.crews).limit(1)).length > 0;
  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="rank-num text-6xl leading-none">Your crew&apos;s all-time favorite songs, ranked.</h1>
      {anyCrew ? (
        <p className="mt-6 text-muted">
          All-Timers is invite-only. Ask someone in your crew for the invite link. Already joined on another device?
          Open Settings there and use &ldquo;Sign in on another device.&rdquo;
        </p>
      ) : (
        <form action={setupCrew} className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6">
          <p className="text-sm text-muted">First time here. Set up your crew; you&apos;ll get an invite link to share.</p>
          <label className="block">
            <span className="text-sm">Crew name</span>
            <input name="crewName" placeholder="The Crew" className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-sm">Your name</span>
            <input name="name" required className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2" />
          </label>
          <button className="rounded-full bg-accent px-5 py-2 font-medium text-black">Create crew</button>
        </form>
      )}
    </div>
  );
}
