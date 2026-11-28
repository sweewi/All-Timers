"use client";

import { useEffect, useState, useTransition } from "react";
import { addFromPlaylist, checkPlaylist, linkPlaylist, type PlaylistCheck } from "@/app/me/actions";

type Fresh = Extract<PlaylistCheck, { ok: true }>["fresh"];

/**
 * The list's home on Spotify. Most people keep their All-Timers as a playlist, so the
 * site follows it: a "Listen on Spotify" link for everyone, and songs added to the
 * playlist later show up here, ready to add (announced if the list is set in stone).
 */
export function PlaylistPanel({
  playlistId,
  stale,
  setInStone,
}: {
  playlistId: string | null;
  /** last check was a while ago: look again on open */
  stale: boolean;
  setInStone: boolean;
}) {
  const [linked, setLinked] = useState(playlistId);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);

  const check = () =>
    start(async () => {
      setMsg(null);
      const r = await checkPlaylist();
      if (!r.ok) return setMsg(r.message);
      setFresh(r.fresh);
      setPicked(new Set(r.fresh.map((f) => f.id)));
      if (!r.fresh.length) setMsg(`Nothing new in “${r.name}”.`);
    });

  useEffect(() => {
    if (linked && stale) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  if (!linked || editing)
    return (
      <div className="note note-blue mt-6 max-w-2xl">
        <b>Where does this list live on Spotify?</b>
        <p className="mt-1 text-sm">
          Paste the playlist link and the column gets a Listen on Spotify button. Songs added to that playlist later show up here, ready
          to add.
        </p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMsg(null);
              const r = await linkPlaylist(input);
              if (!r.ok) return setMsg(r.message);
              setLinked(input);
              setEditing(false);
              setMsg(`Linked “${r.name}”.`);
            });
          }}
        >
          <label htmlFor="pl-link" className="sr-only">
            Spotify playlist link
          </label>
          <input
            id="pl-link"
            className="field min-w-0 flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button type="submit" className="btn btn-gold btn-sm" disabled={pending || !input.trim()}>
            {pending ? "Reading…" : "Link playlist"}
          </button>
          {editing && (
            <button type="button" className="btn btn-marble btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </form>
        {msg && <p className="mt-2 text-sm">{msg}</p>}
      </div>
    );

  return (
    <div className="note note-green mt-6 max-w-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <b className="mr-auto">Lives on Spotify</b>
        <a href={`https://open.spotify.com/playlist/${playlistIdOf(linked)}`} target="_blank" rel="noopener noreferrer" className="btn btn-marble btn-sm">
          Open the playlist
        </a>
        <button type="button" className="btn btn-marble btn-sm" onClick={check} disabled={pending}>
          {pending ? "Checking…" : "Check for new songs"}
        </button>
        <button type="button" className="btn-link text-sm" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
      {fresh && fresh.length > 0 && (
        <div className="mt-3">
          <p className="text-sm">
            {fresh.length === 1 ? "A song was added to the playlist" : `${fresh.length} songs were added to the playlist`} since last time.{" "}
            {setInStone ? "Adding one to a list set in stone tells the group it earned its spot." : "Add the ones that belong."}
          </p>
          <ul className="mt-2 grid gap-1">
            {fresh.map((f) => (
              <li key={f.id}>
                <label className="flex items-center gap-3 rounded px-1 py-1 hover:bg-white/50">
                  <input
                    type="checkbox"
                    checked={picked.has(f.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(f.id);
                      else next.delete(f.id);
                      setPicked(next);
                    }}
                  />
                  {f.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.imageUrl} alt="" width={36} height={36} className="rounded-sm" />
                  ) : (
                    <span className="h-9 w-9 rounded-sm bg-[#e6dcc8]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.name}</span>
                    <span className="block truncate text-sm text-muted">{f.artists}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-gold btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const n = await addFromPlaylist([...picked], fresh.map((f) => f.id));
                  setFresh(null);
                  setMsg(n ? `Added ${n} to the bottom of the list. Drag ${n === 1 ? "it" : "them"} into place.` : "Skipped them. They won't be offered again.");
                })
              }
            >
              {picked.size ? `${setInStone ? "Induct" : "Add"} ${picked.size}` : "Skip these"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** accepts an id or a pasted link */
function playlistIdOf(v: string) {
  const m = v.match(/playlist[/:]([A-Za-z0-9]{22})/);
  return m ? m[1] : v;
}
