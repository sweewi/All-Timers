import Link from "next/link";
import type { User } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCrewMembers, getList, type Entry } from "@/lib/lists";
import { artistList } from "@/lib/songs";
import { Art, TrackTitle } from "@/components/track";
import { Altitude } from "@/components/World";
import { ratingCompare } from "@/lib/ratings";

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const members = await getCrewMembers(viewer.crewId);
  const find = (h: unknown) => members.find((m) => m.handle === h);
  const a = find(sp.a) ?? viewer;
  const b = find(sp.b);

  return (
    <div>
      <Altitude base={0.58} range={0.15} />
      <h1 className="rank-num text-5xl">Compare</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{a.name} vs</span>
        {members
          .filter((m) => m.id !== a.id)
          .map((m) => (
            <Link
              key={m.id}
              href={`/compare?a=${a.handle}&b=${m.handle}`}
              className={`rounded-full border px-3 py-1 ${b?.id === m.id ? "border-accent text-accent" : "border-line"}`}
            >
              {m.name}
            </Link>
          ))}
      </div>
      {b ? <Comparison a={a} b={b} /> : <p className="mt-10 text-muted">Pick someone to compare lists with.</p>}
    </div>
  );
}

const versionKey = (e: Entry) => e.track.isrc ?? e.track.id;

async function Comparison({ a, b }: { a: User; b: User }) {
  const [aAll, bAll, aDeck, bDeck, rc] = await Promise.all([
    getList(a.id, "all_time"),
    getList(b.id, "all_time"),
    getList(a.id, "on_deck"),
    getList(b.id, "on_deck"),
    ratingCompare(a.id, b.id),
  ]);

  // Same exact version (same recording) on both all-time lists.
  const bByVersion = new Map(bAll.map((e) => [versionKey(e), e]));
  const shared = aAll.filter((e) => bByVersion.has(versionKey(e))).map((e) => [e, bByVersion.get(versionKey(e))!] as const);
  const sharedVersions = new Set(shared.map(([x]) => versionKey(x)));

  // Same song, different version: the conversation starter.
  const bBySong = new Map(bAll.map((e) => [e.track.songKey, e]));
  const diffVersion = aAll
    .filter((e) => !sharedVersions.has(versionKey(e)) && bBySong.has(e.track.songKey) && !e.track.songKey.startsWith("unknown|"))
    .map((e) => [e, bBySong.get(e.track.songKey)!] as const)
    .filter(([x, y]) => versionKey(x) !== versionKey(y));

  // One person's all-timer sitting on the other's On Deck.
  const crossDeck = [
    ...aAll.filter((e) => bDeck.some((d) => versionKey(d) === versionKey(e))).map((e) => ({ e, holder: a, decker: b })),
    ...bAll.filter((e) => aDeck.some((d) => versionKey(d) === versionKey(e))).map((e) => ({ e, holder: b, decker: a })),
  ];

  // Artists both people have on their all-time lists, weighted by how many songs each has.
  const count = (list: Entry[]) => {
    const m = new Map<string, number>();
    for (const e of list) for (const art of artistList(e.track.artists)) m.set(art, (m.get(art) ?? 0) + 1);
    return m;
  };
  const aArt = count(aAll);
  const bArt = count(bAll);
  const sharedArtists = [...aArt.keys()]
    .filter((k) => bArt.has(k))
    .map((k) => ({ name: k, a: aArt.get(k)!, b: bArt.get(k)! }))
    .sort((x, y) => y.a + y.b - (x.a + x.b));
  const union = new Set([...aArt.keys(), ...bArt.keys()]).size;
  const artistOverlap = union ? Math.round((sharedArtists.length / union) * 100) : 0;

  const dot = (u: User) => <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: u.color }} />;

  return (
    <div className="mt-10 space-y-12">
      <Altitude base={0.58} range={0.15} />
      <section className="grid gap-4 sm:grid-cols-4">
        <Stat
          label="Taste match"
          value={rc.match != null ? `${rc.match}%` : "—"}
          hint={rc.match != null ? `from ${rc.shared} songs both rated` : `needs 3 songs both rated (${rc.shared} so far)`}
        />
        <Stat label="Songs on both lists" value={shared.length} />
        <Stat label="Same song, different version" value={diffVersion.length} />
        <Stat label="Artist overlap" value={`${artistOverlap}%`} hint={`${sharedArtists.length} shared artists`} />
      </section>

      {(rc.disagree.length > 0 || rc.agree.length > 0) && (
        <section className="grid gap-8 md:grid-cols-2">
          {[
            { title: "Where they split", rows: rc.disagree, empty: "" },
            { title: "Where they agree", rows: rc.agree, empty: "" },
          ]
            .filter((g) => g.rows.length)
            .map((g) => (
              <div key={g.title}>
                <h2 className="rank-num text-3xl">{g.title}</h2>
                <ul className="mt-4 divide-y divide-line">
                  {g.rows.map((r) => (
                    <li key={r.track.id} className="flex items-center gap-3 py-3">
                      <Art track={r.track} />
                      <div className="min-w-0 flex-1">
                        <TrackTitle track={r.track} />
                        {(r.aNote || r.bNote) && (
                          <p className="truncate text-sm italic text-muted">
                            {r.aNote ? a.name : b.name}: &ldquo;{r.aNote ?? r.bNote}&rdquo;
                          </p>
                        )}
                      </div>
                      <span className="flex shrink-0 items-center gap-2 text-sm">
                        <span className="flex items-center gap-1">{dot(a)} <span className="take-score">{r.a.toFixed(1)}</span></span>
                        <span className="flex items-center gap-1">{dot(b)} <span className="take-score">{r.b.toFixed(1)}</span></span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      <section>
        <h2 className="rank-num text-3xl">Both all-timers</h2>
        {shared.length === 0 ? (
          <p className="mt-2 text-muted">No exact songs in common. Check the shared artists below.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {shared.map(([x, y]) => (
              <li key={x.track.id} className="flex items-center gap-4 py-3">
                <Art track={x.track} />
                <div className="min-w-0 flex-1">
                  <TrackTitle track={x.track} />
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    {dot(a)} <span className="rank-num text-xl">#{x.position}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {dot(b)} <span className="rank-num text-xl">#{y.position}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {diffVersion.length > 0 && (
        <section>
          <h2 className="rank-num text-3xl">Same song, different version</h2>
          <ul className="mt-4 space-y-4">
            {diffVersion.map(([x, y]) => (
              <li key={x.track.id} className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
                {[
                  [a, x],
                  [b, y],
                ].map(([u, e]) => (
                  <div key={(u as User).id} className="flex items-center gap-3">
                    <Art track={(e as Entry).track} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        {dot(u as User)} {(u as User).name} · #{(e as Entry).position}
                      </div>
                      <TrackTitle track={(e as Entry).track} />
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {crossDeck.length > 0 && (
        <section>
          <h2 className="rank-num text-3xl">Knocking on the door</h2>
          <ul className="mt-4 divide-y divide-line">
            {crossDeck.map(({ e, holder, decker }) => (
              <li key={`${holder.id}-${e.track.id}`} className="flex items-center gap-4 py-3 text-sm">
                <Art track={e.track} />
                <div className="min-w-0 flex-1">
                  <TrackTitle track={e.track} />
                </div>
                <span className="text-muted">
                  #{e.position} for {holder.name}, on deck for {decker.name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="rank-num text-3xl">Shared artists</h2>
        {sharedArtists.length === 0 ? (
          <p className="mt-2 text-muted">No artists in common yet. Different worlds, which means plenty to steal.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {sharedArtists.map((s) => (
              <li key={s.name} className="sticker sticker-paper">
                {s.name}{" "}
                <span className="text-muted">
                  {s.a}·{s.b}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="rank-num text-5xl">{value}</div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      {hint && <div className="text-xs text-muted/70">{hint}</div>}
    </div>
  );
}

export async function generateMetadata() {
  return { title: "Compare · All-Timers" };
}
