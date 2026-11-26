import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getList } from "@/lib/lists";
import { Art, RankedRow } from "@/components/track";

export default async function ProfilePage({ params, searchParams }: PageProps<"/u/[handle]">) {
  const viewer = await requireUser();
  const { handle } = await params;
  const sp = await searchParams;
  const kind = sp.list === "on_deck" ? "on_deck" : "all_time";
  const db = await getDb();
  const person = (await db.select().from(schema.users).where(eq(schema.users.handle, handle)))[0];
  if (!person || person.crewId !== viewer.crewId) notFound();
  const isMe = person.id === viewer.id;

  const [allTime, onDeck] = await Promise.all([getList(person.id, "all_time"), getList(person.id, "on_deck")]);
  const entries = kind === "on_deck" ? onDeck : allTime;
  const putOns = allTime.filter((e) => e.origin?.fromUser).length;
  const withStory = allTime.filter((e) => e.origin).length;

  return (
    <div>
      <section className="flex flex-wrap items-end gap-6">
        {allTime[0] && <Art track={allTime[0].track} size={120} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: person.color }} />
            <span className="text-sm uppercase tracking-widest text-muted">All-time list</span>
          </div>
          <h1 className="rank-num mt-1 text-6xl leading-none">{person.name}</h1>
          <p className="mt-3 text-sm text-muted">
            {allTime.length} all-timers · {onDeck.length} on deck · {putOns} put on by friends · {withStory} with a story
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isMe ? (
            <>
              <Link href={`/me/edit?list=${kind}`} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-black">
                Edit &amp; add stories
              </Link>
              <Link href={`/me/import?list=${kind}`} className="rounded-full border border-line px-4 py-2 text-sm">
                Import from Spotify
              </Link>
            </>
          ) : (
            <Link href={`/compare?a=${viewer.handle}&b=${person.handle}`} className="rounded-full border border-line px-4 py-2 text-sm">
              Compare with me
            </Link>
          )}
        </div>
      </section>

      <div className="mt-10 flex gap-6 border-b border-line text-sm">
        <Tab href={`/u/${handle}`} active={kind === "all_time"} label={`All-Time (${allTime.length})`} />
        <Tab href={`/u/${handle}?list=on_deck`} active={kind === "on_deck"} label={`On Deck (${onDeck.length})`} />
      </div>

      {entries.length === 0 ? (
        <div className="py-12 text-center text-muted">
          {isMe ? (
            <>
              Nothing here yet.{" "}
              <Link href={`/me/import?list=${kind}`} className="text-accent">
                Import from Spotify →
              </Link>
            </>
          ) : (
            "Nothing here yet."
          )}
        </div>
      ) : (
        <ol>
          {entries.map((e) => (
            <RankedRow key={e.track.id} entry={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={`-mb-px border-b-2 pb-3 ${active ? "border-accent text-foreground" : "border-transparent text-muted"}`}>
      {label}
    </Link>
  );
}
