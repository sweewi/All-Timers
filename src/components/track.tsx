import Link from "next/link";
import type { Track } from "@/db/schema";
import type { Entry } from "@/lib/lists";
import { artistLine } from "@/lib/songs";
import { FOUND_VIA_OPTIONS } from "@/lib/stories";
import { PlayToggle } from "./client";

export function Art({ track, size = 48 }: { track: Pick<Track, "imageUrl" | "name">; size?: number }) {
  return track.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={track.imageUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div className="shrink-0 rounded-md bg-surface-2" style={{ width: size, height: size }} />
  );
}

export function TrackTitle({ track }: { track: Track }) {
  const artists = artistLine(track.artists);
  const version = [track.album, track.releaseYear].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{track.name}</div>
      <div className="truncate text-sm text-muted">
        {artists || "Unknown artist"}
        {version && <span className="text-muted/70"> — {version}</span>}
      </div>
    </div>
  );
}

export function OriginLine({ origin }: { origin: Entry["origin"] }) {
  if (!origin) return null;
  const via = origin.foundVia ?? (origin.fromUserId ? "friend" : origin.fromName ? "someone" : null);
  let found: React.ReactNode = null;
  if (via === "friend" && origin.fromUser) {
    found = (
      <>
        put on by{" "}
        <Link href={`/u/${origin.fromUser.handle}`} className="font-medium" style={{ color: origin.fromUser.color }}>
          {origin.fromUser.name}
        </Link>
      </>
    );
  } else if (via === "someone" && origin.fromName) {
    found = <>put on by {origin.fromName}</>;
  } else if (via) {
    found = FOUND_VIA_OPTIONS.find((o) => o.value === via)?.tag ?? null;
  }
  const when = [origin.whenText, origin.whereText].filter(Boolean).join(", ");
  const meta = [
    found && <span key="f">{found}</span>,
    origin.moment && <span key="m">♪ {origin.moment}</span>,
    when && <span key="w">{when}</span>,
  ].filter(Boolean);
  if (!origin.love && meta.length === 0 && !origin.story) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {origin.love && <p className="text-[15px] leading-relaxed text-foreground/90">{origin.love}</p>}
      {meta.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">{meta}</div>}
      {origin.story && <p className="text-sm italic text-muted">“{origin.story}”</p>}
    </div>
  );
}

export function RankedRow({ entry, storyHref }: { entry: Entry; storyHref?: string }) {
  const told = Boolean(entry.origin && (entry.origin.love || entry.origin.foundVia || entry.origin.fromUserId || entry.origin.story));
  return (
    <li className="flex gap-4 border-b border-line py-4">
      <div className="rank-num w-10 shrink-0 text-right text-3xl leading-none text-muted">{entry.position}</div>
      <Art track={entry.track} size={56} />
      <div className="min-w-0 flex-1">
        <TrackTitle track={entry.track} />
        <OriginLine origin={entry.origin} />
        <div className="mt-2 flex items-start gap-4">
          <PlayToggle trackId={entry.track.id} />
          {storyHref && (
            <Link href={storyHref} className="shrink-0 text-xs text-muted hover:text-accent">
              {told ? "Edit why" : "+ Why it's here"}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
