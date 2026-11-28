import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { shareAGroup } from "@/lib/groups";
import { getList } from "@/lib/lists";
import { ownerOfShareToken } from "@/lib/profile";
import { artistLine } from "@/lib/songs";
import { carvedTitle } from "@/lib/monument";
import { Altitude } from "@/components/World";
import { Art } from "@/components/track";

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const { token } = await params;
  const found = await ownerOfShareToken(token);
  if (!found) return { title: "All-Timers", robots: { index: false } };
  const list = await getList(found.user.id, "all_time");
  const top = list[0];
  const title = `${found.user.name}'s All-Timers`;
  const description = [
    `${list.length} songs${found.profile.setAt ? ", set in stone" : ""}.`,
    top ? `Number one: ${carvedTitle(top.track.name)} by ${artistLine(top.track.artists)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const v = found.profile.updatedAt.getTime().toString(36);
  const image = { url: `/s/${token}/card?format=og&v=${v}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [image], type: "profile" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/**
 * A list for anyone with the link: the songs, in order, with the whys. Friends in a
 * group with the owner land on the full column instead. Nothing from stats.fm, and
 * nobody else's name, is shown here.
 */
export default async function SharedList({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const found = await ownerOfShareToken(token);
  if (!found) notFound();
  const viewer = await getCurrentUser();
  if (viewer && (viewer.id === found.user.id || (await shareAGroup(viewer.id, found.user.id)))) redirect(`/u/${found.user.handle}`);
  const { user, profile } = found;
  const list = await getList(user.id, "all_time");

  return (
    <div className="sky-room shared">
      <Altitude base={0.55} range={0.35} />
      <header className="text-center">
        <p className="sticker sticker-blue -rotate-2">All-Timers</p>
        <h1 className="tall-h mt-4 text-[clamp(64px,14vw,140px)]">{user.name}</h1>
        <p className="tall-sub">
          {list.length} all-time favorite songs, in order{profile.setAt ? "." : ", still being written."}
        </p>
        {profile.setAt && (
          <span className="stone-badge">
            Set in stone · {profile.setAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
        {profile.rules && (
          <p className="mon-rules">
            <q>{profile.rules}</q>
          </p>
        )}
        {profile.playlistId && (
          <p className="mt-5">
            <a href={`https://open.spotify.com/playlist/${profile.playlistId}`} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-lg">
              Listen on Spotify
            </a>
          </p>
        )}
      </header>

      <ol className="shared-list mt-12">
        {list.map((e) => (
          <li key={e.track.id} className={e.position <= 3 ? "is-top" : ""}>
            <span className="shared-rank">{e.position <= 10 ? ROMAN[e.position] : e.position}</span>
            <Art track={e.track} size={e.position === 1 ? 120 : e.position <= 3 ? 84 : 56} />
            <div className="min-w-0 flex-1">
              <a href={`https://open.spotify.com/track/${e.track.id}`} target="_blank" rel="noopener noreferrer" className="shared-title">
                {carvedTitle(e.track.name)}
              </a>
              <div className="shared-artist">{artistLine(e.track.artists)}</div>
              {e.origin?.love && <p className="shared-why">&ldquo;{e.origin.love}&rdquo;</p>}
              {e.origin?.moment && <p className="shared-moment">Best moment: {e.origin.moment}</p>}
            </div>
          </li>
        ))}
      </ol>

      <section className="note note-amber mx-auto mt-14 max-w-xl text-center">
        <b className="text-lg">Which songs are your All-Timers?</b>
        <p className="mt-2">
          Make your own list, set it in stone, and put it next to your friends&apos;. Know {user.name}? Ask for an invite to their group.
        </p>
        <p className="mt-4">
          <Link href="/start" className="btn btn-gold">
            Make my All-Timers
          </Link>
        </p>
      </section>
    </div>
  );
}
