"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addFromListening } from "./actions";

export type Suggestion = { id: string; name: string; artists: string; imageUrl: string | null; streams: number | null; recent: boolean };

/** "You keep playing these": recent heavy rotation that isn't on either list yet. */
export function Suggestions({ items, linked }: { items: Suggestion[]; linked: boolean }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  if (!linked) {
    return (
      <div className="paper-note mt-10 max-w-xl text-sm">
        <b>Want suggestions?</b> Link stats.fm in <Link href="/settings#statsfm" className="underline">Settings</Link> and the songs you
        keep replaying show up here, ready to drop on deck.
      </div>
    );
  }
  if (!items.length) return null;
  return (
    <section className="mt-12">
      <h2 className="rank-num text-3xl">You keep playing these</h2>
      <p className="mt-1 text-sm text-muted">Heavy rotation that isn&apos;t on either list. Knocking on the door?</p>
      <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-background/80">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.imageUrl} alt="" className="h-11 w-11 rounded object-cover" />
            ) : (
              <span className="h-11 w-11 rounded bg-line" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate text-sm text-muted">
                {s.artists} · {s.streams != null ? `${s.streams.toLocaleString()} ${s.streams === 1 ? "play" : "plays"} ${s.recent ? "in 4 weeks" : "in 6 months"}` : `in your top songs ${s.recent ? "lately" : "these months"}`}
              </div>
            </div>
            {added.has(s.id) ? (
              <span className="text-sm text-muted">On deck ✓</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                className="sticker sticker-steal"
                onClick={() =>
                  start(async () => {
                    await addFromListening(s.id, "on_deck");
                    setAdded((a) => new Set(a).add(s.id));
                  })
                }
              >
                + On Deck
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">From your stats.fm.</p>
    </section>
  );
}
