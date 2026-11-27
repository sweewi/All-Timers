import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getList } from "@/lib/lists";
import { Art, RankedRow } from "@/components/track";
import { hasStory } from "@/lib/story-values";
import { backfillTracks } from "@/lib/spotify";
import { after } from "next/server";
import { artistLine } from "@/lib/songs";
import { FOUND_VIA_OPTIONS } from "@/lib/stories";
import type { Entry } from "@/lib/lists";
import { Monument, type MonumentSong } from "./Monument";
import { getSocial } from "@/lib/social";
import { getCrewOverview } from "@/lib/lists";
import { Altitude } from "@/components/World";
import { getReactions, songTarget } from "@/lib/reactions";
import { getPlays, refreshListening } from "@/lib/listening";

function foundText(o: Entry["origin"]) {
  if (!o) return null;
  const via = o.foundVia ?? (o.fromUserId ? "friend" : o.fromName ? "someone" : null);
  if (via === "friend" && o.fromUser) return `Put on by ${o.fromUser.name}`;
  if (via === "someone" && o.fromName) return `Put on by ${o.fromName}`;
  const tag = FOUND_VIA_OPTIONS.find((x) => x.value === via)?.tag;
  return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : null;
}

function playsFor(p: Awaited<ReturnType<typeof getPlays>>, id: string) {
  const hit = p.byTrack.get(id);
  if (hit) return { streams: hit.streams, rank: hit.rank, under: null };
  if (p.floor && p.floor > 0) return { streams: null, rank: null, under: p.floor };
  return null;
}

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
  after(() => backfillTracks());

  // The monument is the default way to see an all-time list; ?view=list is the plain list.
  if (kind === "all_time" && sp.view !== "list" && allTime.length > 0) {
    const [social, overview, reacts, plays] = await Promise.all([
      getSocial(viewer.crewId, viewer.id),
      getCrewOverview(viewer.crewId),
      getReactions(allTime.map((e) => songTarget(person.id, e.track.id)), viewer.id),
      getPlays(person.id, allTime.map((e) => e.track.id)),
    ]);
    // stale numbers are refreshed after the page is sent; the next visit sees them
    after(() => refreshListening(person.id));
    const echoes = social.echoesFor(person.id);
    // the next columns to visit: everyone else with a list, starting after this person
    const order = overview.filter((o) => o.count > 0);
    const at = order.findIndex((o) => o.member.id === person.id);
    const neighbors = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))]
      .filter((o) => o.member.id !== person.id)
      .map((o) => ({
        name: o.member.id === viewer.id ? "You" : o.member.name,
        handle: o.member.handle,
        color: o.member.color,
        count: o.count,
        cover: o.top[0]?.imageUrl ?? null,
        isMe: o.member.id === viewer.id,
      }));
    const songs: MonumentSong[] = allTime.map((e) => ({
      id: e.track.id,
      rank: e.position,
      name: e.track.name,
      artists: artistLine(e.track.artists) || "Unknown artist",
      album: e.track.album,
      year: e.track.releaseYear,
      imageUrl: e.track.imageUrl,
      love: e.origin?.love ?? null,
      moment: e.origin?.moment ?? null,
      found: foundText(e.origin),
      memory: [e.origin?.story, e.origin?.whenText].filter(Boolean).join(" · ") || null,
      echoes: echoes(e.track)
        .filter((h) => h.user.id !== person.id)
        .map((h) => ({ name: h.user.id === viewer.id ? "You" : h.user.name, handle: h.user.handle, color: h.user.color, rank: h.rank })),
      from: e.origin?.fromUser ? { name: e.origin.fromUser.name, handle: e.origin.fromUser.handle, color: e.origin.fromUser.color } : null,
      steal: !isMe && !social.has(e.track),
      reactions: reacts[songTarget(person.id, e.track.id)] ?? {},
      plays: plays.shown ? playsFor(plays, e.track.id) : null,
    }));
    const counted = songs.filter((x) => x.plays?.streams != null);
    const mostPlayed = counted.length >= 3 ? counted.reduce((a, b) => (b.plays!.streams! > a.plays!.streams! ? b : a)) : null;
    const receipts =
      plays.shown || plays.totals
        ? {
            streams: plays.totals?.streams ?? null,
            hours: plays.totals?.hours ?? null,
            mostPlayed: mostPlayed && mostPlayed.rank !== 1 ? { name: mostPlayed.name, rank: mostPlayed.rank, streams: mostPlayed.plays!.streams! } : null,
            topIsMost: !!mostPlayed && mostPlayed.rank === 1,
          }
        : null;
    const btn = "sticker sticker-paper sticker-lg";
    return (
      <Monument
        person={{ id: person.id, name: person.name, handle: person.handle, color: person.color }}
        neighbors={neighbors}
        songs={songs}
        receipts={receipts}
        isMe={isMe}
        storyHref={`/me/stories?list=all_time`}
        toolbar={
          <>
            <Link href={isMe ? "/me/edit" : `/u/${handle}?view=list`} className={btn}>
              {isMe ? "List & reorder" : "List view"}
            </Link>
            {onDeck.length > 0 && (
              <Link href={isMe ? "/me/edit?list=on_deck" : `/u/${handle}?list=on_deck`} className={btn}>
                On Deck ({onDeck.length})
              </Link>
            )}
            {isMe ? null : (
              <Link href={`/compare?a=${viewer.handle}&b=${person.handle}`} className={btn}>Compare with me</Link>
            )}

          </>
        }
      />
    );
  }
  // your own list as a list is the editable one: one place to read it and reorder it
  if (isMe) redirect(`/me/edit${kind === "on_deck" ? "?list=on_deck" : ""}`);
  const entries = kind === "on_deck" ? onDeck : allTime;
  const putOns = allTime.filter((e) => e.origin?.fromUser).length;
  const withStory = allTime.filter((e) => hasStory(e.origin)).length;
  const untold = entries.filter((e) => !hasStory(e.origin)).length;

  return (
    <div>
      <Altitude base={0.4} range={0.2} />
      <section className="flex flex-wrap items-end gap-6">
        {allTime[0] && <Art track={allTime[0].track} size={120} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: person.color }} />
            <span className="text-sm uppercase tracking-widest text-muted">All-time list</span>
          </div>
          <h1 className="rank-num mt-1 text-6xl leading-none">{person.name}</h1>
          <p className="mt-3 text-sm text-muted">
            {allTime.length} all-timers · {onDeck.length} on deck · {putOns} put on by friends · {withStory} with a why
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isMe ? (
            <>
              <Link href={`/me/edit?list=${kind}`} className="rounded-full border border-line px-4 py-2 text-sm">
                Reorder
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
          {allTime.length > 0 && (
            <Link href={`/u/${handle}`} className="rounded-full border border-line px-4 py-2 text-sm">
              Monument view
            </Link>
          )}
        </div>
      </section>

      {isMe && entries.length > 0 && untold > 0 && (
        <Link
          href={`/me/stories?list=${kind}`}
          className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 hover:bg-accent/15"
        >
          <div>
            <div className="font-medium text-accent">Say why they&apos;re here</div>
            <div className="text-sm text-muted">
              {untold} {untold === 1 ? "song doesn't" : "songs don't"} have a why yet. Go one at a time, skip any you want.
            </div>
          </div>
          <span className="text-accent">→</span>
        </Link>
      )}

      <div className="mt-10 flex gap-6 border-b border-line text-sm">
        <Tab href={`/u/${handle}?view=list`} active={kind === "all_time"} label={`All-Time (${allTime.length})`} />
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
            <RankedRow
              key={e.track.id}
              entry={e}
              storyHref={isMe ? `/me/stories?list=${kind}&track=${e.track.id}` : undefined}
            />
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
