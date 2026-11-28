import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { getCrewOverview } from "@/lib/lists";
import { Art } from "@/components/track";
import { ShareSheet } from "@/components/ShareSheet";
import { Altitude } from "@/components/World";
import { type GroundMember } from "@/components/Grounds";
import { Promenade } from "@/components/Promenade";
import { promenadeScreens } from "@/lib/promenade";
import { Doors } from "@/components/Portal";
import { getSocial } from "@/lib/social";
import { getReactions, movesTarget } from "@/lib/reactions";
import { Reactions, type Counts } from "@/components/Reactions";
import { artistLine } from "@/lib/songs";
import { carvedTitle } from "@/lib/monument";
import { setupCrew } from "./actions";
import { after } from "next/server";
import { backfillTracks } from "@/lib/spotify";
import { getAccount, refreshListening } from "@/lib/listening";
import { getNews, recentWhys, type NewsItem, type Why } from "@/lib/plaza";
import { getProfiles } from "@/lib/profile";
import { myGroups } from "@/lib/groups";
import { GroupSticker } from "@/components/GroupSticker";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) return <SignedOut />;

  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const [overview, news, whys, social, groups, acct] = await Promise.all([
    getCrewOverview(user.crewId),
    getNews(user.crewId, 10),
    recentWhys(user.crewId, 12),
    getSocial(user.crewId, user.id),
    myGroups(user.id),
    getAccount(user.id),
  ]);
  const [profiles, reacts] = await Promise.all([
    getProfiles(overview.map((o) => o.member.id)),
    getReactions(news.filter((n) => n.type === "added").map((n) => movesTarget((n as Extract<NewsItem, { type: "added" }>).batchId)), user.id),
  ]);
  const mine = overview.find((o) => o.member.id === user.id);
  after(async () => {
    await backfillTracks();
    if (acct) await refreshListening(user.id, { only: ["weeks", "months", "profile"] });
  });
  const members: GroundMember[] = overview.map(({ member, count, top }) => ({
    name: member.name,
    handle: member.handle,
    color: member.color,
    count,
    cover: top[0]?.imageUrl ?? null,
    isMe: member.id === user.id,
    setInStone: !!profiles.get(member.id)?.setAt,
  }));
  const invite = `/join/${crew.inviteCode}`;
  const ghosts = Math.max(0, 3 - members.length);
  const walk = promenadeScreens(members.length + ghosts);

  return (
    <div className="home">
      {/* first you walk along the plaza, then scrolling lifts you off the sand into the sky */}
      <Altitude stops={[{ y: 0, alt: 0 }, { y: walk, alt: 0 }, { y: walk + 1, alt: 0.3125 }, { y: "end", alt: 0.92 }]} />
      <Promenade members={members} ghosts={ghosts}>
        <div className="hero">
          <GroupSticker name={crew.name} groups={groups.map((g) => ({ id: g.crew.id, name: g.crew.name, current: g.crew.id === crew.id }))} />
          <h1 className="hero-line">
            Which songs are
            <br />
            <em>your All-Timers?</em>
          </h1>
          <p className="hero-sub">
            {members.length > 1 ? `${members.length} lists on the plaza. Tap a column to climb it.` : "The plaza fills up as friends join. Send them the invite."}
          </p>
          {mine && mine.count === 0 && (
            <Link href="/me/import" className="btn btn-gold btn-lg mt-5">
              Raise my column
            </Link>
          )}
        </div>
        {news.length > 0 && <Ticker items={news.map(tickerLine)} />}
      </Promenade>

      <div className="home-sections">
        <section>
          <h2 className="tall-h">The latest</h2>
          <p className="tall-sub">Lists barely change once they&apos;re made, so every one of these is a big deal.</p>
          {news.length === 0 ? (
            <p className="paper-note">Quiet so far. New lists, songs added and lists set in stone show up here.</p>
          ) : (
            <div className="scraps">
              {news.map((item, i) => (
                <NewsScrap
                  key={`${item.type}-${item.user.id}-${item.at.getTime()}`}
                  item={item}
                  i={i}
                  reacts={item.type === "added" ? reacts[movesTarget(item.batchId)] : undefined}
                  mine={item.user.id === user.id}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="tall-h">Why it&apos;s on there</h2>
          <p className="tall-sub">The memories and the moments behind the songs. Tap one to climb that column.</p>
          {whys.length === 0 ? (
            <p className="paper-note">
              No whys yet. They&apos;re the best part.{" "}
              <Link href="/me/stories" className="underline">
                Write the first one
              </Link>
              .
            </p>
          ) : (
            <div className="rail">
              {whys.map((w, i) => (
                <WhyCard key={`${w.user.id}-${w.track.id}`} w={w} i={i} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="tall-h">Common ground</h2>
          <p className="tall-sub">Songs on more than one list.</p>
          {social.shared.length === 0 ? (
            <p className="paper-note">
              No overlaps yet. {overview.length < 2 ? "It takes two lists." : "Everyone's taste is their own, for now."}
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
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="invite">
          <h2 className="tall-h">Doors</h2>
          <p className="tall-sub">Every room in the place.</p>
          <Doors
            width={240}
            doors={[
              { href: `/u/${user.handle}`, label: "My column", sub: mine?.count ? `${mine.count} songs` : "raise it", cover: mine?.top[0]?.imageUrl, tone: "night" },
              { href: "/me/stories", label: "The why room", sub: "tell the stories", tone: "sea", inside: <span className="portal-word">“ ”</span> },
              { href: "/me/share", label: "My card", sub: "show off the list", tone: "dawn", inside: <span className="portal-word">✦</span> },
              { href: "/me/import", label: "Add songs", sub: "from Spotify", tone: "night", inside: <span className="portal-word">+</span> },
            ]}
          />
          <div className="note note-blue mt-10 max-w-xl">
            <b>Bring more people in.</b> Send the invite to the group chat; it shows up as a card with everyone&apos;s #1s.
            <ShareSheet
              className="mt-3"
              path={invite}
              label="Share the invite"
              message={`Come put your all-time favorite songs next to ours on All-Timers (${crew.name}):`}
            />
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

function tickerLine(item: NewsItem) {
  const who = item.user.name;
  if (item.type === "stone") return `${who} set their All-Timers in stone`;
  if (item.type === "joined") return `${who} joined`;
  if (item.tracks.length > 3) return `${who} added ${item.tracks.length} songs`;
  const t = item.tracks[0];
  return `${who} ${item.afterStone ? "inducted" : "added"} ${carvedTitle(t.track.name)} at #${t.pos}`;
}

function NewsScrap({ item, i, reacts, mine }: { item: NewsItem; i: number; reacts?: Counts; mine: boolean }) {
  const name = (
    <Link href={`/u/${item.user.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: item.user.color }}>
      {item.user.name}
    </Link>
  );
  const art = item.type === "stone" ? item.top : item.type === "added" ? item.tracks[0].track : null;
  let text: React.ReactNode;
  if (item.type === "stone") {
    text = (
      <>
        {name} set their All-Timers in stone: <b>{item.count} songs</b>, for life.
      </>
    );
  } else if (item.type === "joined") {
    text = <>{name} joined the group. Their column goes up as soon as they add a list.</>;
  } else if (item.tracks.length > 5) {
    text = (
      <>
        {name} added {item.tracks.length} songs to their list
      </>
    );
  } else {
    text = (
      <>
        {name} {item.afterStone ? "inducted" : "added"}{" "}
        {item.tracks.map((t, k) => (
          <span key={t.track.id}>
            {k > 0 && (k === item.tracks.length - 1 ? " and " : ", ")}
            <b>{carvedTitle(t.track.name)}</b> at #{t.pos}
          </span>
        ))}
        {item.afterStone && <span className="text-muted">, to a list set in stone</span>}
      </>
    );
  }
  return (
    <div className={`scrap ${item.type === "stone" || (item.type === "added" && item.afterStone) ? "scrap-stone" : ""}`} style={{ rotate: `${[-1.6, 1.2, -0.6, 1.8, -1.1, 0.7][i % 6]}deg` }}>
      <span className="scrap-tape" />
      {art ? <Art track={art} size={64} /> : <span className="scrap-blank" style={{ ["--c" as string]: item.user.color }} />}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-snug">{text}</div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <time className="text-xs text-muted">{timeAgo(item.at)}</time>
          {item.type === "added" && <Reactions target={movesTarget(item.batchId)} initial={reacts} canReact={!mine} size="sm" />}
        </div>
      </div>
    </div>
  );
}

function WhyCard({ w, i }: { w: Why; i: number }) {
  const words = w.love ?? w.story ?? "";
  return (
    <Link href={`/u/${w.user.handle}`} className="why-card" style={{ rotate: `${((i * 37) % 5) - 2}deg`, ["--c" as string]: w.user.color }}>
      <span className="why-head">
        {w.track.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={w.track.imageUrl} alt="" />
        )}
        <span className="min-w-0">
          <b>{carvedTitle(w.track.name)}</b>
          <small>{artistLine(w.track.artists)}</small>
        </span>
      </span>
      <q>{words.length > 180 ? `${words.slice(0, 177)}…` : words}</q>
      {w.moment && <span className="why-moment">Best moment: {w.moment}</span>}
      <span className="why-foot">
        <span className="sticker sticker-friend">{w.user.name}&apos;s #{w.rank}</span>
        {w.from && <span className="text-xs text-muted">put on by {w.from.name}</span>}
      </span>
    </Link>
  );
}

function timeAgo(d: Date) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * The front door for someone not signed in. It says nothing about who's inside: groups
 * are private, so the way in is an invite link or starting a list of your own.
 */
async function SignedOut() {
  const db = await getDb();
  const empty = (await db.select({ id: schema.crews.id }).from(schema.crews).limit(1)).length === 0;
  return (
    <div className="mx-auto max-w-xl py-12">
      <Altitude base={0.3} range={0.1} />
      <h1 className="tall-h text-[clamp(56px,12vw,120px)]">Which songs are your All-Timers?</h1>
      <p className="tall-sub mt-4">The handful of songs that get you the most, in order, with why each one made it. Set in stone, next to your friends&apos;.</p>
      {empty ? (
        <form action={setupCrew} className="note note-blue mt-8 grid gap-4">
          <b>Start the first group</b>
          <label className="grid gap-1">
            <span className="text-sm">My name</span>
            <input name="name" required maxLength={40} className="field" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm">Group name (optional)</span>
            <input name="crewName" maxLength={60} placeholder="e.g. The Boys, Saturday Club" className="field" />
          </label>
          <button className="btn btn-gold justify-self-start">Start</button>
        </form>
      ) : (
        <div className="note note-blue mt-8 grid gap-3">
          <p>
            <b>Got an invite link?</b> Open it and you&apos;re in. Already signed in on another device? Open Settings there and make a link
            for this one.
          </p>
          <p>
            <Link href="/start" className="btn btn-gold">
              Make my All-Timers
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
