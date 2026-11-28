import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCrewMembers, getList } from "@/lib/lists";
import { artistLine } from "@/lib/songs";
import { EditClient, type EditItem } from "./EditClient";
import { hasStory, toStoryValues } from "@/lib/story-values";
import { Altitude } from "@/components/World";
import { getAccount, onDeckSuggestions } from "@/lib/listening";
import { Suggestions } from "./Suggestions";
import { PlaylistPanel } from "./PlaylistPanel";
import { getProfile, playlistIsStale } from "@/lib/profile";

export default async function EditPage({ searchParams }: PageProps<"/me/edit">) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = sp.list === "on_deck" ? "on_deck" : "all_time";
  const db = await getDb();
  const [entries, members, crew] = await Promise.all([
    getList(user.id, kind),
    getCrewMembers(user.crewId),
    db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)),
  ]);

  const [other, acct, profile] = await Promise.all([
    getList(user.id, kind === "on_deck" ? "all_time" : "on_deck"),
    getAccount(user.id),
    getProfile(user.id),
  ]);
  const playlistStale = playlistIsStale(profile);
  const have = new Set([...entries, ...other].map((e) => e.track.id));
  const suggestions = acct ? await onDeckSuggestions(user.id, have, 8) : [];

  const items: EditItem[] = entries.map((e) => ({
    id: e.track.id,
    name: e.track.name,
    artists: artistLine(e.track.artists),
    version: [e.track.album, e.track.releaseYear].filter(Boolean).join(" · "),
    imageUrl: e.track.imageUrl,
    story: toStoryValues(e.origin),
    hasStory: hasStory(e.origin),
  }));

  return (
    <div>
      <Altitude base={0.3} range={0.25} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/u/${user.handle}`} className="text-sm text-muted">
            ← Back to my column
          </Link>
          <h1 className="rank-num mt-1 text-5xl">{kind === "on_deck" ? "On Deck" : "My All-Timers"}</h1>
          <p className="mt-2 text-sm text-muted">
            {kind === "on_deck"
              ? "Songs knocking on the door. Drag to reorder; move one up to All-Time when it earns it."
              : "The list, in order. Drag to reorder, or type a new rank number. Open a song to say why it's here."}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/me/edit"
            className={`rounded-full border px-4 py-2 ${kind === "all_time" ? "border-accent text-accent" : "border-line"}`}
          >
            All-Time
          </Link>
          <Link
            href="/me/edit?list=on_deck"
            className={`rounded-full border px-4 py-2 ${kind === "on_deck" ? "border-accent text-accent" : "border-line"}`}
          >
            On Deck
          </Link>
        </div>
      </div>
      {kind === "all_time" && <PlaylistPanel playlistId={profile?.playlistId ?? null} stale={playlistStale} setInStone={!!profile?.setAt} />}
      <EditClient
        kind={kind}
        initial={items}
        members={members.filter((m) => m.id !== user.id).map((m) => ({ id: m.id, name: m.name, color: m.color }))}
        inviteCode={crew[0].inviteCode}
      />
      {kind === "on_deck" && (
        <Suggestions
          linked={!!acct}
          items={suggestions.map((x) => ({
            id: x.track.id,
            name: x.track.name,
            artists: artistLine(x.track.artists),
            imageUrl: x.track.imageUrl,
            streams: x.streams,
            recent: x.period === "weeks",
          }))}
        />
      )}
    </div>
  );
}
