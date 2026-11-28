import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getList } from "@/lib/lists";
import { cardOf, getProfile } from "@/lib/profile";
import { Altitude } from "@/components/World";
import { CardStudio } from "./CardStudio";

export const metadata: Metadata = { title: "My card · All-Timers" };

export default async function SharePage() {
  const user = await requireUser();
  const [list, profile] = await Promise.all([getList(user.id, "all_time"), getProfile(user.id)]);
  return (
    <div className="mx-auto max-w-5xl">
      <Altitude base={0.5} range={0.2} />
      <Link href={`/u/${user.handle}`} className="text-sm text-muted">
        ← Back to my column
      </Link>
      <h1 className="rank-num mt-1 text-5xl">My card</h1>
      <p className="mt-2 max-w-2xl text-muted">
        The list as one image: for a story, the group chat, or anyone new. Pick a look; the one saved here is also what shows up under
        the link when it&apos;s shared.
      </p>
      {list.length === 0 ? (
        <p className="note note-amber mt-8 max-w-xl">
          A card needs a list first.{" "}
          <Link href="/me/import" className="underline">
            Add songs
          </Link>
          .
        </p>
      ) : (
        <CardStudio name={user.name} initial={cardOf(profile)} token={profile?.shareToken ?? null} />
      )}
    </div>
  );
}
