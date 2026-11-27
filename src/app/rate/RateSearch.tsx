"use client";

import { useState, useTransition } from "react";
import { findSongs, type FoundSong } from "./actions";
import { RateButton } from "@/components/RateFlow";

/** Find any song to rate: by name from what the group already has, or by pasting a Spotify link. */
export function RateSearch() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="paper-note max-w-2xl">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length < 2) return;
          setError(null);
          start(async () => {
            try {
              setFound(await findSongs(q));
            } catch {
              setError("Search didn't go through. Try again in a moment.");
            }
          });
        }}
      >
        <label htmlFor="rate-find" className="sr-only">
          Song name or Spotify link
        </label>
        <input id="rate-find" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song, artist, or a Spotify link" maxLength={500} />
        <button type="submit" className="btn btn-gold" disabled={pending}>
          {pending ? "Finding…" : "Find"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-[#a2432f]">{error}</p>}
      {found && (
        <ul className="mt-3 divide-y divide-[#e6dcc8]">
          {found.length === 0 && (
            <li className="py-2 text-sm text-muted">Nothing here by that name yet. Paste the song&apos;s Spotify link to rate anything.</li>
          )}
          {found.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" width={40} height={40} className="rounded-sm" />
              ) : (
                <span className="h-10 w-10 rounded-sm bg-[#e6dcc8]" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-sm text-muted">{s.artists}</span>
              </span>
              <RateButton song={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
