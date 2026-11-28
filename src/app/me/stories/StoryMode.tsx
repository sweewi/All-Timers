"use client";

import { useState } from "react";
import Link from "next/link";
import type { ListKind } from "@/db/schema";
import { StoryForm, type StoryValues } from "@/components/StoryForm";

export type StoryItem = {
  id: string;
  rank: number;
  name: string;
  artists: string;
  album: string;
  imageUrl: string | null;
  color: string | null;
  story: StoryValues;
  done: boolean;
};

type Member = { id: string; name: string; color: string };

export function StoryMode({
  kind,
  handle,
  items,
  startAt,
  members,
  inviteCode,
}: {
  kind: ListKind;
  handle: string;
  items: StoryItem[];
  startAt: string | null;
  members: Member[];
  inviteCode: string;
}) {
  const [done, setDone] = useState(() => new Set(items.filter((i) => i.done).map((i) => i.id)));
  const [stories, setStories] = useState(() => new Map(items.map((i) => [i.id, i.story])));
  const first = startAt ? items.findIndex((i) => i.id === startAt) : items.findIndex((i) => !i.done);
  const [index, setIndex] = useState(first >= 0 ? first : 0);
  const [finished, setFinished] = useState(items.length > 0 && items.every((i) => i.done) && !startAt);
  const back = `/u/${handle}${kind === "on_deck" ? "?list=on_deck" : ""}`;

  if (items.length === 0) {
    return (
      <p className="py-16 text-center text-muted">
        Your list is empty.{" "}
        <Link href={`/me/import?list=${kind}`} className="text-accent">
          Import it first →
        </Link>
      </p>
    );
  }

  /** Next song without a story after this one; wraps around once. */
  const advance = (justDone?: string) => {
    const doneNow = new Set(done);
    if (justDone) doneNow.add(justDone);
    for (let step = 1; step <= items.length; step++) {
      const i = (index + step) % items.length;
      if (!doneNow.has(items[i].id)) {
        setIndex(i);
        return;
      }
    }
    setFinished(true);
  };

  if (finished) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="rank-num text-6xl">Every song has its why.</div>
        <p className="mt-4 text-muted">That&apos;s your list told properly. Everyone will see it on your profile.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href={back} className="btn btn-gold">
            See my list
          </Link>
          <button type="button" onClick={() => setFinished(false)} className="btn btn-marble">
            Keep editing
          </button>
        </div>
      </div>
    );
  }

  const item = items[index];
  const tint = item.color ?? "#2a2420";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-4 text-sm text-muted">
        <Link href={back}>← My list</Link>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${(done.size / items.length) * 100}%` }} />
        </div>
        <span>
          {done.size} of {items.length} told
        </span>
      </div>

      <div
        key={item.id}
        className="mt-6 overflow-hidden rounded-3xl border border-line"
        style={{ background: `linear-gradient(160deg, ${tint}44 0%, var(--surface) 60%)` }}
      >
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-end">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-40 w-40 shrink-0 rounded-xl object-cover shadow-2xl" />
          ) : (
            <div className="h-40 w-40 shrink-0 rounded-xl bg-surface-2" />
          )}
          <div className="min-w-0">
            <div className="rank-num text-5xl leading-none">#{item.rank}</div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight">{item.name}</h1>
            <div className="mt-1 text-foreground/70">
              {item.artists || "Unknown artist"}
              {item.album && <span className="text-foreground/50"> · {item.album}</span>}
            </div>
          </div>
        </div>
        <iframe
          title="Spotify player"
          src={`https://open.spotify.com/embed/track/${item.id}?utm_source=generator&theme=0`}
          width="100%"
          height="80"
          className="block px-6"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
        <div className="p-6">
          <StoryForm
            key={item.id}
            trackId={item.id}
            trackName={item.name}
            initial={stories.get(item.id)!}
            members={members}
            inviteCode={inviteCode}
            saveLabel="Save & next"
            autoFocus
            onSaved={(values) => {
              setStories((prev) => new Map(prev).set(item.id, values));
              setDone((prev) => new Set(prev).add(item.id));
              advance(item.id);
            }}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-between text-sm">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          className="text-muted hover:text-foreground disabled:opacity-30"
        >
          ← Previous song
        </button>
        <button
          type="button"
          onClick={() => setIndex((index + 1) % items.length)}
          className="text-muted hover:text-foreground"
        >
          Skip for now →
        </button>
      </div>
    </div>
  );
}
