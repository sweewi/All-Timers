import Link from "next/link";
import type { Track } from "@/db/schema";
import type { Entry } from "@/lib/lists";
import { artistLine } from "@/lib/songs";
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
  const who = origin.fromUser ? (
    <>
      put on by{" "}
      <Link href={`/u/${origin.fromUser.handle}`} className="font-medium" style={{ color: origin.fromUser.color }}>
        {origin.fromUser.name}
      </Link>
    </>
  ) : origin.fromName ? (
    <>from {origin.fromName}</>
  ) : null;
  const bits = [origin.whenText, origin.whereText].filter(Boolean).join(" · ");
  if (!who && !bits && !origin.story) return null;
  return (
    <div className="mt-1.5 text-sm text-muted">
      {who}
      {who && bits && " · "}
      {bits}
      {origin.story && <p className="mt-1 italic text-foreground/80">“{origin.story}”</p>}
    </div>
  );
}

export function RankedRow({ entry }: { entry: Entry }) {
  return (
    <li className="flex gap-4 border-b border-line py-4">
      <div className="rank-num w-10 shrink-0 text-right text-3xl leading-none text-muted">{entry.position}</div>
      <Art track={entry.track} size={56} />
      <div className="min-w-0 flex-1">
        <TrackTitle track={entry.track} />
        <OriginLine origin={entry.origin} />
        <div className="mt-2">
          <PlayToggle trackId={entry.track.id} />
        </div>
      </div>
    </li>
  );
}
