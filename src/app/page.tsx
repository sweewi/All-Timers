import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getCrewFeed, getCrewOverview, type FeedItem } from "@/lib/lists";
import { Art } from "@/components/track";
import { ShareInvite } from "@/components/ShareInvite";
import { Altitude } from "@/components/World";
import { Grounds, type GroundMember } from "@/components/Grounds";
import { Portal } from "@/components/Portal";
import { StealButton } from "@/components/StealButton";
import { getSocial } from "@/lib/social";
import { getReactions, movesTarget } from "@/lib/reactions";
import { Reactions, type Counts } from "@/components/Reactions";
import { artistLine } from "@/lib/songs";
import { carvedTitle } from "@/lib/monument";
import { setupCrew } from "./actions";
import { after } from "next/server";
import { backfillTracks } from "@/lib/spotify";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const [overview, feed, social] = await Promise.all([
    getCrewOverview(user.crewId),
    getCrewFeed(user.crewId, 12),
    getSocial(user.crewId, user.id),
  ]);
  const mine = overview.find((o) => o.member.id === user.id);
  const reacts = await getReactions(feed.map((f) => movesTarget(f.batchId)), user.id);
  after(() => backfillTracks());
  const members: GroundMember[] = overview.map(({ member, count, top }) => ({
    name: member.name,
    handle: member.handle,
    color: member.color,
    count,
    cover: top[0]?.imageUrl ?? null,
    isMe: member.id === user.id,
  }));
  const invite = `/join/${crew.inviteCode}`;

  return (
    <div className="home">
      {/* scrolling down lifts you off the sand and up into the clouds */}
      <Altitude stops={[{ y: 0, alt: 0 }, { y: 1, alt: 0.4 }, { y: "end", alt: 0.92 }]} />
      <Grounds members={members} title={/all-timers$/i.test(crew.name) ? "All·Timers" : crew.name} ghosts={Math.max(0, 3 - members.length)} />

      <section className="hero">
        <p className="sticker sticker-blue -rotate-2">{crew.name}</p>
        <h1 className="hero-line">
          Hey {user.name.split(" ")[0]},
          <br />
          <em>{feed.length ? "the columns moved." : "pick a column."}</em>
        </h1>
        <p className="hero-sub">Tap anyone&apos;s column to climb it. Scroll to fly up.</p>
        {mine && mine.count === 0 && (
          <Link href="/me/import" className="sticker sticker-steal pointer-events-auto mt-4 inline-block rotate-1 text-base">
            Raise your column →
          </Link>
        )}
        {feed.length > 0 && <Ticker items={feed.map(tickerLine)} />}
      </section>

      <div className="home-sections">
        <section>
          <h2 className="tall-h">
            Fresh moves <span className="sticker sticker-paper rotate-3">{feed.length ? "live" : "quiet so far"}</span>
          </h2>
          {feed.length === 0 ? (
            <p className="paper-note">Nothing yet. Adds, climbs and drops land here the second anyone touches their list.</p>
          ) : (
            <div className="scraps">
              {feed.map((item, i) => (
                <Scrap key={item.batchId} item={item} i={i} reacts={reacts[movesTarget(item.batchId)]} mine={item.user.id === user.id} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="tall-h">Common ground</h2>
          <p className="tall-sub">Songs more than one of you swear by.</p>
          {social.shared.length === 0 ? (
            <p className="paper-note">
              No overlaps yet. {overview.length < 2 ? "It takes two columns." : "Everyone's taste is their own, for now."}
            </p>
          ) : (
            <div className="rail">
              {social.shared.slice(0, 14).map((sh) => (
                <div key={sh.track.id} className="medal">
                  <span className="medal-art">
                    {sh.track.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sh.track.imageUrl} alt="" />
                    )}
                    <span className="medal-count">×{sh.holders.length}</span>
                  </span>
                  <b>{carvedTitle(sh.track.name)}</b>
                  <small>{artistLine(sh.track.artists)}</small>
                  <span className="mt-2 flex flex-wrap justify-center gap-1">
                    {sh.holders.map((h) => (
                      <Link key={h.user.id} href={`/u/${h.user.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: h.user.color }}>
                        {h.user.id === user.id ? "You" : h.user.name} #{h.rank}
                      </Link>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="tall-h">
            Steal from friends <span className="sticker sticker-steal -rotate-3">new picks daily</span>
          </h2>
          <p className="tall-sub">Their all-timers you don&apos;t have yet. Steal one and it lands in your On Deck, credited to them.</p>
          {social.picks.length === 0 ? (
            <p className="paper-note">{overview.length < 2 ? "Once friends add their lists, their best songs show up here." : "You already have everything your friends love. Suspicious."}</p>
          ) : (
            <div className="rail">
              {social.picks.map((pk, i) => (
                <div key={pk.track.id} className="loot" style={{ rotate: `${((i * 37) % 5) - 2}deg` }}>
                  {pk.track.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pk.track.imageUrl} alt="" className="loot-art" />
                  )}
                  <b>{carvedTitle(pk.track.name)}</b>
                  <small>{pk.artists}</small>
                  <Link href={`/u/${pk.from.handle}`} className="sticker sticker-friend mt-2 self-start" style={{ ["--c" as string]: pk.from.color }}>
                    {pk.from.name}&apos;s #{pk.rank}
                  </Link>
                  <span className="mt-2">
                    <StealButton trackId={pk.track.id} fromUserId={pk.from.id} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="invite">
          <h2 className="tall-h">Doors</h2>
          <p className="tall-sub">Every room in the place.</p>
          <div className="doors">
            <Portal href={`/u/${user.handle}`} label="Your column" sub={mine?.count ? `${mine.count} songs` : "raise it"} cover={mine?.top[0]?.imageUrl} tone="night" />
            <Portal href="/compare" label="Compare" sub="you vs anyone" tone="dawn" inside={<span className="portal-word">VS</span>} />
            <Portal href="/me/stories" label="The why room" sub="tell the stories" tone="sea" inside={<span className="portal-word">“ ”</span>} />
            <Portal href="/me/import" label="Add songs" sub="from Spotify" tone="night" inside={<span className="portal-word">+</span>} />
          </div>
          <div className="paper-note mt-10 max-w-xl">
            <b>Bring more people in.</b> Columns get interesting in a crowd.
            <div className="mt-3">
              <ShareInvite path={invite} groupName={crew.name} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The wire: a strip of tape running across the plaza with everything that just happened. */
function Ticker({ items }: { items: string[] }) {
  const run = items.join("   ✦   ");
  return (
    <div className="ticker" aria-label="Latest moves">
      <div className="ticker-run">
        <span>{run}   ✦   </span>
        <span aria-hidden>{run}   ✦   </span>
      </div>
    </div>
  );
}

function tickerLine(item: FeedItem) {
  const who = item.user.name;
  const adds = item.events.filter((e) => e.type === "add");
  const moves = item.events.filter((e) => e.type === "move").sort((x, y) => (y.fromPos! - y.toPos!) - (x.fromPos! - x.toPos!));
  if (adds.length > 3) return `${who} added ${adds.length} songs`;
  const m = moves[0];
  if (m) return `${who} moved ${carvedTitle(m.track.name)} ${m.fromPos! > m.toPos! ? "up" : "down"} to #${m.toPos}`;
  if (adds[0]) return `${who} added ${carvedTitle(adds[0].track.name)} at #${adds[0].toPos}`;
  const r = item.events.find((e) => e.type === "remove");
  return r ? `${who} dropped ${carvedTitle(r.track.name)}` : `${who} touched their list`;
}

function Scrap({ item, i, reacts, mine }: { item: FeedItem; i: number; reacts?: Counts; mine: boolean }) {
  return (
    <div className="scrap" style={{ rotate: `${[-1.6, 1.2, -0.6, 1.8, -1.1, 0.7][i % 6]}deg` }}>
      <span className="scrap-tape" />
      <Art track={item.events[0].track} size={64} />
      <div className="min-w-0 flex-1">
        <FeedText item={item} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <time className="text-xs text-muted">{timeAgo(item.createdAt)}</time>
          <Reactions target={movesTarget(item.batchId)} initial={reacts} canReact={!mine} size="sm" />
        </div>
      </div>
    </div>
  );
}

const listName = (k: string) => (k === "on_deck" ? "On Deck" : "All-Time list");

function FeedText({ item }: { item: FeedItem }) {
  const adds = item.events.filter((e) => e.type === "add");
  const moves = item.events.filter((e) => e.type === "move");
  const removes = item.events.filter((e) => e.type === "remove");
  const name = (
    <Link href={`/u/${item.user.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: item.user.color }}>
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
    for (const a of adds) parts.push(<>added <b>{carvedTitle(a.track.name)}</b> at #{a.toPos}</>);
    for (const m of [...moves].sort((x, y) => (y.fromPos! - y.toPos!) - (x.fromPos! - x.toPos!)).slice(0, 3)) {
      const up = m.fromPos! > m.toPos!;
      parts.push(
        <>
          moved <b>{carvedTitle(m.track.name)}</b> {up ? "up" : "down"} #{m.fromPos} → #{m.toPos}
        </>,
      );
    }
    for (const r of removes.slice(0, 2)) parts.push(<>dropped <b>{carvedTitle(r.track.name)}</b></>);
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
  return <div className="text-[15px] leading-snug">{text}</div>;
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
  const crew = (await db.select().from(schema.crews).limit(1))[0];
  const admin = crew
    ? (await db.select().from(schema.users).where(eq(schema.users.crewId, crew.id))).find((u) => u.isAdmin)
    : null;
  return (
    <div className="mx-auto max-w-xl py-12">
      <Altitude base={0.3} range={0.1} />
      <h1 className="tall-h text-[clamp(56px,12vw,120px)]">Everyone&apos;s all-time songs, standing tall.</h1>
      {crew ? (
        <p className="paper-note mt-6">
          This is {crew.name}. To join, ask {admin?.name ?? "whoever runs it"} for the invite link. Already in on another
          device? Open Settings there and tap &ldquo;Make a sign-in link.&rdquo;
        </p>
      ) : (
        <form action={setupCrew} className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6">
          <div>
            <h2 className="font-medium">Start your group</h2>
            <p className="mt-1 text-sm text-muted">
              You only do this once. You&apos;ll get one invite link; everyone you send it to joins this same group.
            </p>
          </div>
          <label className="block">
            <span className="text-sm">Your name</span>
            <input name="name" required className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-sm">Group name (optional)</span>
            <input
              name="crewName"
              placeholder="e.g. The Boys, Saturday Club"
              className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2"
            />
          </label>
          <button className="rounded-full bg-accent px-5 py-2 font-medium text-black">Start</button>
        </form>
      )}
    </div>
  );
}
