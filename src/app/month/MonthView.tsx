import Link from "next/link";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { getCrewMembers } from "@/lib/lists";
import { getAccounts, monthKeyOf, monthLabel, visibility } from "@/lib/listening";
import {
  NOMINATIONS_PER_PERSON,
  ensureRound,
  firstPicks,
  getBallot,
  getPool,
  getResults,
  getRound,
  pastRounds,
  phaseOf,
  poolIsStale,
  refreshPool,
  revealIfDue,
  votersOf,
} from "@/lib/monthly";
import { artistLine } from "@/lib/songs";
import { carvedTitle, roman } from "@/lib/monument";
import { timeLeft } from "@/lib/time";
import { APP_TZ } from "@/lib/listening";
import { Altitude } from "@/components/World";
import { queueMonthMirror, syncMonth } from "@/lib/mirror";
import { Ballot, type PoolCard } from "./Ballot";
import { NominateForm } from "./NominateForm";
import { SavePlaylist } from "./SavePlaylist";


export async function MonthView({ viewer, month }: { viewer: User; month: string }) {
  const current = monthKeyOf();
  if (month > current) return <NotYet />;
  let round = month === current ? await ensureRound(viewer.crewId, month) : await getRound(viewer.crewId, month);
  if (!round) return <NotYet past />;
  const wasOpen = round.status === "open";
  round = await revealIfDue(round);
  // the month's playlist reorders into the final ranking at the reveal
  if (wasOpen && round.status === "revealed") queueMonthMirror(round.id);

  // the first look at a month builds its pool right away; after that it grows in the background
  if (round.status === "open") {
    if (!round.poolBuiltAt) {
      await refreshPool(round);
      queueMonthMirror(round.id);
    } else if (poolIsStale(round)) {
      const r = round;
      after(async () => {
        await refreshPool(r);
        await syncMonth(r.id); // unchanged songs cost nothing
      });
    }
  }

  const db = await getDb();
  const members = await getCrewMembers(viewer.crewId);
  const [pool, ballot, voters, past, accts, mirror] = await Promise.all([
    getPool(round.id),
    getBallot(round.id, viewer.id),
    votersOf(round.id),
    pastRounds(viewer.crewId),
    getAccounts(members.map((x) => x.id)),
    db.select().from(schema.spotifyMirrors).where(eq(schema.spotifyMirrors.key, `month:${round.id}`)),
  ]);
  const who = new Map(members.map((m) => [m.id, m]));
  const { phase, reveal } = phaseOf(round);
  const label = monthLabel(month);
  const monthName = label.split(" ")[0];
  const linked = [...accts.values()].filter((a) => visibility(a).tops).length;
  const revealText = new Date(reveal).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", timeZone: APP_TZ });
  const playlistUrl = mirror[0]?.url ?? null;

  const cards: PoolCard[] = pool.map((p) => ({
    id: p.track.id,
    name: carvedTitle(p.track.name),
    artists: artistLine(p.track.artists),
    imageUrl: p.track.imageUrl,
    nominatedBy: p.nominatedBy ? (p.nominatedBy === viewer.id ? "you" : (who.get(p.nominatedBy)?.name ?? "someone")) : null,
    mine: p.nominatedBy === viewer.id,
    from: p.detail
      .filter((d) => who.has(d.userId))
      .map((d) => {
        const u = who.get(d.userId)!;
        // play counts follow each person's "show my play counts" switch; the rank always shows
        const showCount = u.id === viewer.id || visibility(accts.get(u.id)).plays;
        return { name: u.id === viewer.id ? "You" : u.name, color: u.color, rank: d.rank, streams: showCount ? d.streams : null };
      }),
  }));
  const myNominations = pool.filter((p) => p.nominatedBy === viewer.id).length;

  return (
    <div className="monthly">
      <Altitude base={0.35} range={0.35} />
      <header className="monthly-hero">
        <p className="sticker sticker-blue -rotate-2">{label}</p>
        <h1 className="tall-h mt-4">The {monthName} list</h1>
        <p className="tall-sub max-w-2xl">
          {phase === "revealed"
            ? "Everyone's most-played of the month, ranked by all of you."
            : `Everyone's most-played this month goes in the pool. Rank your favorites; the group's list is revealed ${revealText}.`}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {phase === "open" && <span className="sticker sticker-steal rotate-1">reveal in {timeLeft(reveal)}</span>}
          {members.map((m) => (
            <span
              key={m.id}
              className={`sticker sticker-friend ${voters.has(m.id) || phase === "revealed" ? "" : "opacity-60"}`}
              style={{ ["--c" as string]: m.color }}
              title={voters.has(m.id) ? "voted" : "hasn't voted yet"}
            >
              {voters.has(m.id) && "✓ "}
              {m.id === viewer.id ? "You" : m.name}
            </span>
          ))}
        </div>
        {playlistUrl && <SavePlaylist url={playlistUrl} revealed={phase === "revealed"} />}
      </header>

      {phase === "revealed" ? (
        <Results roundId={round.id} who={who} viewerId={viewer.id} />
      ) : (
        <section className="monthly-body">
          {cards.length === 0 ? (
            <div className="paper-note">
              <b>The pool is empty so far.</b>{" "}
              {linked === 0 ? (
                <>
                  The pool fills itself from everyone&apos;s stats.fm. Nobody has linked it yet:{" "}
                  <Link href="/settings#statsfm" className="underline">link yours in Settings</Link>, or nominate a song below.
                </>
              ) : (
                <>It fills from what linked members played this month. Nominate something below to get it going.</>
              )}
            </div>
          ) : (
            <Ballot month={month} pool={cards} initial={ballot} />
          )}
          <div className="paper-note mt-10">
            <b>Nominate a song</b>
            <p className="mt-1 text-sm text-[#6e624f]">
              Something the plays missed? Paste a Spotify song link. You get {NOMINATIONS_PER_PERSON} a month ({NOMINATIONS_PER_PERSON - myNominations} left).
            </p>
            {myNominations < NOMINATIONS_PER_PERSON && <NominateForm month={month} />}
          </div>
          <p className="mt-4 text-xs text-white/80">
            Pool: each person&apos;s top 5 by plays this calendar month, weighted so everyone counts the same however much they listen. Plays via{" "}
            <a href="https://stats.fm" target="_blank" rel="noopener noreferrer" className="underline">stats.fm</a>.
          </p>
        </section>
      )}

      {past.filter((r) => r.month !== month).length > 0 && (
        <section className="monthly-body mt-[16vh]">
          <h2 className="tall-h text-5xl">Past months</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            {past
              .filter((r) => r.month !== month)
              .map((r) => (
                <Link key={r.id} href={r.month === current ? "/month" : `/month/${r.month}`} className="sticker sticker-paper sticker-lg">
                  {monthLabel(r.month)}
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

async function Results({ roundId, who, viewerId }: { roundId: string; who: Map<string, User>; viewerId: string }) {
  const [results, firsts] = await Promise.all([getResults(roundId), firstPicks(roundId)]);
  const voted = results.some((r) => r.voters > 0);
  if (!results.length) {
    return (
      <section className="monthly-body">
        <p className="paper-note">Nothing was in the pool this month.</p>
      </section>
    );
  }
  const podium = results.slice(0, 3);
  const rest = results.slice(3);
  const firstBy = new Map<string, string[]>();
  for (const f of firsts) {
    const u = who.get(f.userId);
    if (u) firstBy.set(f.trackId, [...(firstBy.get(f.trackId) ?? []), u.id === viewerId ? "You" : u.name]);
  }
  return (
    <section className="monthly-body">
      {!voted && <p className="paper-note mb-8">Nobody voted, so the plays decided.</p>}
      <div className="podium">
        {podium.map((r) => (
          <div key={r.track.id} className={`podium-step podium-${r.position}`}>
            {r.track.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.track.imageUrl} alt="" />
            )}
            <span className="podium-num">{roman(r.position)}</span>
            <b>{carvedTitle(r.track.name)}</b>
            <small>{artistLine(r.track.artists)}</small>
            {voted && <span className="podium-score">{Math.round(r.score * 100)}</span>}
            {firstBy.get(r.track.id) && <span className="mt-2 text-xs">#1 for {firstBy.get(r.track.id)!.join(", ")}</span>}
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <ol className="paper-note mt-10 max-w-3xl divide-y divide-[#e6dcc8]">
          {rest.map((r) => (
            <li key={r.track.id} className="flex items-center gap-3 py-2">
              <span className="w-8 text-right font-[family-name:var(--font-garamond)] text-lg text-[#8a7a5c]">{r.position}</span>
              {r.track.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.track.imageUrl} alt="" className="h-10 w-10 rounded-sm object-cover" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{carvedTitle(r.track.name)}</span>
                <span className="block truncate text-sm text-[#8a7f6d]">
                  {artistLine(r.track.artists)}
                  {firstBy.get(r.track.id) && ` · #1 for ${firstBy.get(r.track.id)!.join(", ")}`}
                </span>
              </span>
              {voted && (
                <span className="w-24">
                  <span className="score-bar" style={{ ["--w" as string]: `${Math.round(r.score * 100)}%` }} />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {voted && <p className="mt-3 text-xs text-white/80">Score: average ballot points, 100 = everyone&apos;s #1.</p>}
    </section>
  );
}

function NotYet({ past = false }: { past?: boolean }) {
  return (
    <div className="monthly">
      <Altitude base={0.35} range={0.2} />
      <section className="monthly-hero">
        <h1 className="tall-h">{past ? "No list that month" : "Not yet"}</h1>
        <p className="tall-sub">
          <Link href="/month" className="underline">Go to this month&apos;s list</Link>
        </p>
      </section>
    </div>
  );
}
