import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCrewMembers, getList } from "@/lib/lists";
import { artistLine } from "@/lib/songs";
import { hasStory, toStoryValues } from "@/lib/story-values";
import { StoryMode, type StoryItem } from "./StoryMode";
import { Altitude } from "@/components/World";

/** Go through your list one song at a time and say why each one is here. */
export default async function StoriesPage({ searchParams }: PageProps<"/me/stories">) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = sp.list === "on_deck" ? "on_deck" : "all_time";
  const db = await getDb();
  const [entries, members, crew] = await Promise.all([
    getList(user.id, kind),
    getCrewMembers(user.crewId),
    db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)),
  ]);
  const items: StoryItem[] = entries.map((e) => ({
    id: e.track.id,
    rank: e.position,
    name: e.track.name,
    artists: artistLine(e.track.artists),
    album: [e.track.album, e.track.releaseYear].filter(Boolean).join(" · "),
    imageUrl: e.track.imageUrl,
    color: e.track.color,
    story: toStoryValues(e.origin),
    done: hasStory(e.origin),
  }));
  const startAt = typeof sp.track === "string" ? sp.track : null;

  return (
    <>
    <Altitude base={0.7} range={0.1} />
    <StoryMode
      kind={kind}
      handle={user.handle}
      items={items}
      startAt={startAt}
      members={members.filter((m) => m.id !== user.id).map((m) => ({ id: m.id, name: m.name, color: m.color }))}
      inviteCode={crew[0].inviteCode}
    />
    </>
  );
}
