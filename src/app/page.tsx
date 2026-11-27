import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getCrewFeed, getCrewOverview, type FeedItem } from "@/lib/lists";
import { Art } from "@/components/track";
import { ShareInvite } from "@/components/ShareInvite";
import { Altitude } from "@/components/World";
import { type GroundMember } from "@/components/Grounds";
import { Promenade } from "@/components/Promenade";
import { promenadeScreens } from "@/lib/promenade";
import { Doors } from "@/components/Portal";
import { StealButton } from "@/components/StealButton";
import { getSocial } from "@/lib/social";
import { getReactions, movesTarget, takeTarget } from "@/lib/reactions";
import { Reactions, type Counts } from "@/components/Reactions";
import { artistLine } from "@/lib/songs";
import { carvedTitle } from "@/lib/monument";
import { setupCrew } from "./actions";
import { after } from "next/server";
import { backfillTracks } from "@/lib/spotify";
import { getAccounts, getLiveNow, heavyRotation, refreshListening, visibility } from "@/lib/listening";
import { compact } from "@/lib/time";
import { myGroups } from "@/lib/groups";
import { freshTakes, groupRatingsFor } from "@/lib/ratings";
import { RateButton } from "@/components/RateFlow";
import { GroupSticker } from "@/components/GroupSticker";

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
  const [reacts, live, rotation, accts, groups, takes] = await Promise.all([
    getReactions(feed.map((f) => movesTarget(f.batchId)), user.id),
    getLiveNow(user.crewId, 0), // cache only during render; the browser asks for fresh data
    heavyRotation(user.crewId),
    getAccounts(overview.map((o) => o.member.id)),
    myGroups(user.id),
    freshTakes(user.crewId, 10),
  ]);
  const scoreIds = [...new Set([...social.shared.map((s) => s.track.id), ...rotation.map((r) => r.track.id), ...takes.map((t) => t.track.id)])];
  const [scored, takeReacts] = await Promise.all([
    groupRatingsFor(user.crewId, scoreIds),
    getReactions(takes.map((t) => takeTarget(t.user.id, t.track.id)), user.id),
  ]);
  const myScore = (id: string) => scored.get(id)?.find((r) => r.userId === user.id)?.score ?? null;
  const rateable = (t: { id: string; name: string; artists: string; imageUrl: string | null }) => ({ id: t.id, name: carvedTitle(t.name), artists: artistLine(t.artists), imageUrl: t.imageUrl });
  const liveEnabled = [...accts.values()].some((a) => visibility(a).live);
  const linked = accts.has(user.id);
  after(async () => {
    await backfillTracks();
    if (linked) await refreshListening(user.id, { only: ["weeks", "months", "profile"] });
  });
  const members: GroundMember[] = overview.map(({ member, count, top }) => ({
    name: member.name,
    handle: member.handle,
    color: member.color,
    count,
    cover: top[0]?.imageUrl ?? null,
    isMe: member.id === user.id,
  }));
  const invite = `/join/${crew.inviteCode}`;
  const ghosts = Math.max(0, 3 - members.length);
  const walk = promenadeScreens(members.length + ghosts);

  return (
    <div className="home">
      {/* first you walk along the plaza, then scrolling lifts you off the sand into the sky */}
      <Altitude stops={[{ y: 0, alt: 0 }, { y: walk, alt: 0 }, { y: walk + 1, alt: 0.3125 }, { y: "end", alt: 0.92 }]} />
      <Promenade members={members} ghosts={ghosts} live={live} liveEnabled={liveEnabled}>
        <div className="hero">
          <GroupSticker name={crew.name} groups={groups.map((g) => ({ id: g.crew.id, name: g.crew.name, current: g.crew.id === crew.id }))} />
          <h1 className="hero-line">
            Which songs are
            <br />
            <em>our All-Timers?</em>
          </h1>
          <p className="hero-sub">
            {members.length > 1 ? `${members.length} columns on the plaza. Tap one to climb it.` : "The plaza fills up as friends join. Send them the invite."}
          </p>
          {mine && mine.count === 0 && (
            <Link href="/me/import" className="sticker sticker-steal mt-4 inline-block rotate-1 text-base">
              Raise your column →
            </Link>
          )}
        </div>
        {feed.length > 0 && <Ticker items={feed.map(tickerLine)} />}
      </Promenade>

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
          <h2 className="tall-h">
            The takes <span className="sticker sticker-paper -rotate-2">scores out of 10</span>
          </h2>
          <p className="tall-sub">What everyone&apos;s rating, and where somebody went against the room.</p>
          {takes.length === 0 ? (
            <p className="paper-note">
              No ratings yet. <Link href="/rate" className="underline">Rate a few songs</Link> and they show up here for everyone.
            </p>
          ) : (
            <div className="scraps">
              {takes.slice(0, 6).map((t, i) => (
                <div key={`${t.user.id}-${t.track.id}`} className="scrap" style={{ rotate: `${[1.1, -1.4, 0.6, -0.8, 1.6, -0.5][i % 6]}deg` }}>
                  <span className="scrap-tape" />
                  <Art track={t.track} size={64} />
                  <div className="min-w-0 flex-1">
                    <p>
                      <Link href={`/u/${t.user.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: t.user.color }}>
                        {t.user.name}
                      </Link>{" "}
                      gave <b>{carvedTitle(t.track.name)}</b> <span className="take-score">{t.score.toFixed(1)}</span>
                      {t.hot && <span className="hot-take">hot take</span>}
                    </p>
                    {t.note && <p className="take-note mt-1">&ldquo;{t.note}&rdquo;</p>}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">
                        {timeAgo(t.at)}
                        {t.others.length > 0 && ` · ${t.others.map((o) => `${o.name} ${o.score.toFixed(1)}`).join(", ")}`}
                      </span>
                      <span className="flex items-center gap-2">
                        <Reactions target={takeTarget(t.user.id, t.track.id)} initial={takeReacts[takeTarget(t.user.id, t.track.id)]} canReact={t.user.id !== user.id} size="sm" />
                        {t.user.id !== user.id && <RateButton song={rateable(t.track)} score={myScore(t.track.id)} />}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-4">
            <Link href="/rate" className="btn btn-gold">
              Go rate songs
            </Link>
          </p>
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
                        {h.user.name} #{h.rank}
                      </Link>
                    ))}
                    <RateButton song={rateable(sh.track)} score={myScore(sh.track.id)} />
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
            <p className="paper-note">{overview.length < 2 ? "Once friends add their lists, their best songs show up here." : "Every friend's favorite is already on a list here. Suspicious."}</p>
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

        <section>
          <h2 className="tall-h">
            On repeat <span className="sticker sticker-paper rotate-2">last 4 weeks</span>
          </h2>
          <p className="tall-sub">What everyone actually can&apos;t stop playing. Rankings are what you say; this is what you do.</p>
          {rotation.length === 0 ? (
            <p className="paper-note">
              {linked ? "Nobody else has linked stats.fm yet." : "Link stats.fm in "}
              {!linked && <Link href="/settings#statsfm" className="underline">Settings</Link>}
              {!linked && " and your heavy rotation shows up here, next to everyone else's."}
            </p>
          ) : (
            <div className="rail">
              {rotation.map((r, i) => {
                const mineToo = r.user.id === user.id;
                return (
                  <div key={`${r.user.id}-${r.track.id}`} className="loot" style={{ rotate: `${((i * 53) % 5) - 2}deg` }}>
                    {r.track.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.track.imageUrl} alt="" className="loot-art" />
                    )}
                    <b>{carvedTitle(r.track.name)}</b>
                    <small>{artistLine(r.track.artists)}</small>
                    <span className="mt-2 flex flex-wrap items-center gap-1">
                      <Link href={`/u/${r.user.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: r.user.color }}>
                        {r.user.name}
                      </Link>
                      <span className="sticker sticker-paper">{r.streams != null ? `${compact(r.streams)} plays` : `their #${r.position} lately`}</span>
                      <RateButton song={rateable(r.track)} score={myScore(r.track.id)} />
                    </span>
                    {!mineToo && !social.has(r.track) && (
                      <span className="mt-2">
                        <StealButton trackId={r.track.id} fromUserId={r.user.id} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {rotation.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Play counts from <a href="https://stats.fm" target="_blank" rel="noopener noreferrer" className="underline">stats.fm</a>, for people who linked it.
            </p>
          )}
        </section>

        <section id="invite">
          <h2 className="tall-h">Doors</h2>
          <p className="tall-sub">Every room in the place.</p>
          <Doors
            width={240}
            doors={[
              { href: `/u/${user.handle}`, label: "My column", sub: mine?.count ? `${mine.count} songs` : "raise it", cover: mine?.top[0]?.imageUrl, tone: "night" },
              { href: "/month", label: "This month", sub: "rank the group's plays", tone: "sea", inside: <span className="portal-word">♪</span> },
              { href: "/rate", label: "Ratings", sub: "score songs, see the takes", tone: "night", inside: <span className="portal-word">8.4</span> },
              { href: "/compare", label: "Compare", sub: "any two of us", tone: "dawn", inside: <span className="portal-word">VS</span> },
              { href: "/me/stories", label: "The why room", sub: "tell the stories", tone: "sea", inside: <span className="portal-word">“ ”</span> },
              { href: "/me/import", label: "Add songs", sub: "from Spotify", tone: "night", inside: <span className="portal-word">+</span> },
            ]}
          />
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
    ? (
        await db
          .select({ name: schema.users.name })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(and(eq(schema.memberships.crewId, crew.id), eq(schema.memberships.role, "admin")))
          .limit(1)
      )[0]
    : null;
  return (
    <div className="mx-auto max-w-xl py-12">
      <Altitude base={0.3} range={0.1} />
      <h1 className="tall-h text-[clamp(56px,12vw,120px)]">Everyone&apos;s all-time songs, standing tall.</h1>
      {crew ? (
        <p className="paper-note mt-6">
          This is {crew.name}. To join, ask {admin?.name ?? "whoever runs it"} for the invite link. Already in on another
          device? Open Settings there and tap &ldquo;Make a link for my other device.&rdquo;
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
          <button className="btn btn-gold">Start</button>
        </form>
      )}
    </div>
  );
}
