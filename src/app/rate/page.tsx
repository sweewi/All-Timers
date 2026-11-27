import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCrewMembers } from "@/lib/lists";
import { freshTakes, groupTop, myRanking, rateQueue, tasteMatches } from "@/lib/ratings";
import { artistLine } from "@/lib/songs";
import { timeAgo } from "@/lib/time";
import { RateButton } from "@/components/RateFlow";
import { Altitude } from "@/components/World";
import { Art } from "@/components/track";
import { BANDS } from "@/lib/rating-math";
import { RateSearch } from "./RateSearch";
import { getReactions, takeTarget } from "@/lib/reactions";
import { Reactions } from "@/components/Reactions";

export const metadata = { title: "Ratings · All-Timers" };

const song = (t: { id: string; name: string; artists: string; imageUrl: string | null }) => ({ id: t.id, name: t.name, artists: artistLine(t.artists), imageUrl: t.imageUrl });

export default async function RatePage() {
  const user = await requireUser();
  const [queue, takes, chart, mine, matches, members] = await Promise.all([
    rateQueue(user.id, user.crewId),
    freshTakes(user.crewId, 14),
    groupTop(user.crewId, 15),
    myRanking(user.id),
    tasteMatches(user.id, user.crewId),
    getCrewMembers(user.crewId),
  ]);
  const reacts = await getReactions(takes.map((t) => takeTarget(t.user.id, t.track.id)), user.id);
  const myScore = new Map(mine.map((m) => [m.track.id, m.r.score]));
  const friends = members.filter((m) => m.id !== user.id).map((m) => ({ ...m, ...(matches.get(m.id) ?? { match: null, shared: 0 }) }));
  friends.sort((a, b) => (b.match ?? -1) - (a.match ?? -1));

  return (
    <div className="monthly rate-page grid gap-20">
      <Altitude base={0.42} range={0.2} />
      <header>
        <h1 className="tall-h">Ratings</h1>
        <p className="tall-sub max-w-2xl">
          Every song gets a gut call, then a few quick head-to-heads against songs already rated. The score comes from where it lands.
        </p>
      </header>

      <section>
        <h2 className="tall-h text-4xl">Up next</h2>
        <p className="tall-sub">From this month&apos;s pool and everyone&apos;s columns.</p>
        {queue.length ? (
          <div className="rail mt-4">
            {queue.map((q, i) => (
              <div key={q.track.id} className="loot" style={{ rotate: `${((i * 53) % 5) - 2}deg` }}>
                {q.track.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.track.imageUrl} alt="" className="loot-art" />
                )}
                <b>{q.track.name}</b>
                <small>{artistLine(q.track.artists)}</small>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{q.why}</span>
                  <RateButton song={song(q.track)} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="paper-note mt-4">Everything in sight is rated. Find something new below.</p>
        )}
      </section>

      <section>
        <h2 className="tall-h text-4xl">Rate anything</h2>
        <div className="mt-4">
          <RateSearch />
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="tall-h text-4xl">Fresh takes</h2>
          <p className="tall-sub">What the group just rated.</p>
          {takes.length ? (
            <ul className="paper-note mt-4 max-w-none divide-y divide-[#e6dcc8]">
              {takes.map((t) => (
                <li key={`${t.user.id}-${t.track.id}`} className="flex gap-3 py-3">
                  <Art track={t.track} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <Link href={`/u/${t.user.handle}`} className="font-semibold" style={{ color: t.user.color }}>
                        {t.user.name}
                      </Link>{" "}
                      gave <b>{t.track.name}</b> a <span className="take-score">{t.score.toFixed(1)}</span>
                      {t.hot && <span className="hot-take">hot take</span>}
                    </p>
                    {t.note && <p className="take-note">&ldquo;{t.note}&rdquo;</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">
                        {timeAgo(t.at.getTime())}
                        {t.others.length > 0 && ` · group avg ${(t.others.reduce((s, o) => s + o.score, 0) / t.others.length).toFixed(1)}`}
                      </span>
                      <Reactions target={takeTarget(t.user.id, t.track.id)} initial={reacts[takeTarget(t.user.id, t.track.id)]} canReact={t.user.id !== user.id} size="sm" />
                    </div>
                  </div>
                  {t.user.id !== user.id && <RateButton song={song(t.track)} score={myScore.get(t.track.id)} className="self-center" />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="paper-note mt-4">No ratings in the group yet. The first one sets the bar.</p>
          )}
        </div>

        <div>
          <h2 className="tall-h text-4xl">Group chart</h2>
          <p className="tall-sub">Highest rated across everyone, weighted by how many rated it.</p>
          {chart.length ? (
            <ol className="paper-note mt-4 max-w-none divide-y divide-[#e6dcc8]">
              {chart.map((c, i) => (
                <li key={c.trackId} className="flex items-center gap-3 py-2">
                  <span className="chart-pos">{i + 1}</span>
                  <Art track={c.track} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.track.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {artistLine(c.track.artists)} · {c.raters} {c.raters === 1 ? "rating" : "ratings"}
                    </span>
                  </span>
                  <span className="take-score">{c.average.toFixed(1)}</span>
                  <RateButton song={song(c.track)} score={myScore.get(c.trackId)} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="paper-note mt-4">The chart fills in once a few people rate the same songs.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="tall-h text-4xl">Taste match</h2>
        <p className="tall-sub">How closely {user.name}&apos;s scores line up with everyone else&apos;s, on songs both rated.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {friends.map((f) => (
            <Link key={f.id} href={`/compare?a=${user.handle}&b=${f.handle}`} className="match-chip" style={{ ["--c" as string]: f.color }}>
              <b>{f.name}</b>
              <span>{f.match != null ? `${f.match}%` : f.shared ? `${f.shared} shared, need 3` : "nothing shared yet"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section id="mine">
        <h2 className="tall-h text-4xl">My ratings</h2>
        <p className="tall-sub">{mine.length ? `${mine.length} rated, best first.` : "Nothing rated yet. Start with Up next."}</p>
        {mine.length > 0 && (
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            {(["loved", "fine", "disliked"] as const).map((b) => {
              const rows = mine.filter((m) => m.r.bucket === b);
              return (
                <div key={b} className="paper-note max-w-none">
                  <h3 className="font-semibold">
                    {BANDS[b].label} <span className="text-sm font-normal text-muted">{rows.length}</span>
                  </h3>
                  <ol className="mt-2 grid gap-2">
                    {rows.map((m) => (
                      <li key={m.track.id} className="flex items-center gap-2">
                        <Art track={m.track} size={32} />
                        <span className="min-w-0 flex-1 truncate text-sm">{m.track.name}</span>
                        <RateButton song={song(m.track)} score={m.r.score} />
                      </li>
                    ))}
                    {!rows.length && <li className="text-sm text-muted">None yet.</li>}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
