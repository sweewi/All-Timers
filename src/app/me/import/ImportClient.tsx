"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListKind } from "@/db/schema";
import { previewImport, saveImport, type PreviewResult } from "./actions";

export function ImportClient({ kind, handle }: { kind: ListKind; handle: string }) {
  const router = useRouter();
  const [isMac, setIsMac] = useState(true);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once on mount, after hydration
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);
  const mod = isMac ? "⌘" : "Ctrl";

  const runPreview = (value: string) =>
    start(async () => {
      setError(null);
      try {
        const res = await previewImport(value, kind);
        setPreview(res);
        if (res.error) setError(res.error);
        else if (res.tracks.length === 0) {
          setError(res.playlists ? "That playlist has no songs we can read." : "No Spotify links found there. Paste a playlist link or song links.");
        }
      } catch {
        setError("Something went wrong reading those links. Try again.");
      }
    });

  const save = (mode: "replace" | "append") =>
    start(async () => {
      if (!preview) return;
      const res = await saveImport(
        kind,
        preview.tracks.map((t) => t.id),
        mode,
      );
      router.push(`/u/${res.handle}${kind === "on_deck" ? "?list=on_deck" : ""}`);
    });

  return (
    <div className="mt-8 space-y-8">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="font-medium">Paste your playlist&apos;s link</div>
        <p className="mt-1 text-sm text-muted">
          In Spotify, open the playlist → ••• (or Share) → <b>Copy link to playlist</b>. Works from your phone.
        </p>
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">The playlist has to be public. How do I check?</summary>
          <p className="mt-1">
            Spotify only shows public playlists to anyone outside your account. On your phone: open the playlist → ••• → if you see{" "}
            <b>Make public</b>, tap it. (If it says <b>Make private</b>, it&apos;s already public.) You can make it private again
            after importing; your list here stays.
          </p>
        </details>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runPreview(link);
          }}
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={500}
            className="field"
          />
          <button
            type="button"
            className="btn btn-marble btn-sm"
            onClick={async () => {
              try {
                const t = (await navigator.clipboard?.readText())?.trim().slice(0, 500);
                if (t) {
                  setLink(t);
                  runPreview(t);
                }
              } catch {
                setError("Couldn't read the clipboard. Paste the link into the box instead.");
              }
            }}
          >
            Paste from clipboard
          </button>
          <button disabled={!link.trim() || pending} className="btn btn-gold">
            {pending ? "Reading…" : "Read playlist"}
          </button>
        </form>
        {error && !showLinks && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>

      <button type="button" onClick={() => setShowLinks((v) => !v)} className="text-sm text-muted underline-offset-4 hover:underline">
        {showLinks ? "Hide" : "Over 100 songs, or a private playlist? Paste the songs instead"}
      </button>

      {showLinks && (
        <>
      <ol className="grid gap-3 sm:grid-cols-2">
        <Step n={1} title="Open the Spotify desktop app">
          On a computer, open the playlist with your list.
        </Step>
        <Step n={2} title="Click any song once">
          Just select it, don&apos;t play it.
        </Step>
        <Step n={3} title={`Press ${mod} + A`}>Selects every song in the playlist.</Step>
        <Step n={4} title={`Press ${mod} + C, then paste below`}>
          That copies a link for every song, in order. Paste it into the box with {mod} + V.
        </Step>
      </ol>

      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (pasted) {
              e.preventDefault();
              const next = text ? `${text}\n${pasted}` : pasted;
              setText(next);
              runPreview(next);
            }
          }}
          rows={6}
          placeholder="https://open.spotify.com/track/…"
          className="w-full rounded-2xl border border-line bg-surface p-4 font-mono text-sm"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => runPreview(text)}
            disabled={!text.trim() || pending}
            className="btn btn-marble btn-sm"
          >
            {pending ? "Reading…" : "Read links"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
        </>
      )}

      {preview && preview.tracks.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5">
          {preview.playlist && (
            <div className="mb-4 flex items-center gap-3">
              {preview.playlist.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.playlist.imageUrl} alt="" className="h-14 w-14 rounded object-cover" />
              )}
              <div>
                <div className="font-medium">{preview.playlist.name}</div>
                {preview.playlist.truncated && (
                  <div className="text-sm text-red-700">
                    Spotify only shows the first {preview.tracks.length} of {preview.playlist.total ?? "its"} songs this way. Save these, then
                    paste the rest as song links (button above) with &ldquo;Add to the bottom&rdquo;.
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="font-medium">{preview.tracks.length} songs found</div>
            <div className="text-sm text-muted">
              {[
                preview.duplicates && `${preview.duplicates} duplicate${preview.duplicates > 1 ? "s" : ""} skipped`,
                preview.alreadyOnList && `${preview.alreadyOnList} already on your list`,
                preview.tracks.some((t) => !t.known) && "some songs couldn't be looked up yet (they'll still save)",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <ol className="mt-4 max-h-96 space-y-2 overflow-auto pr-2">
            {preview.tracks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 text-sm">
                <span className="rank-num w-8 text-right text-xl text-muted">{i + 1}</span>
                {t.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded bg-surface-2" />
                )}
                <div className="min-w-0">
                  <div className="truncate">{t.name}</div>
                  <div className="truncate text-muted">
                    {t.artists}
                    {t.album && ` — ${t.album}${t.year ? ` · ${t.year}` : ""}`}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {preview.diff.current > 0 && (
            <p className="mt-4 text-sm text-muted">
              Replacing keeps this order: {preview.diff.added} new, {preview.diff.removed} of your current {preview.diff.current} would drop off.
              Adding to the bottom keeps your list and appends the {preview.diff.added} new ones.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => save("replace")}
              disabled={pending}
              className="btn btn-gold"
            >
              {preview.diff.current ? "Replace" : "Save as"} my {kind === "on_deck" ? "On Deck" : "All-Time"} list
            </button>
            <button
              type="button"
              onClick={() => save("append")}
              disabled={pending}
              className="btn btn-marble"
            >
              Add to the bottom of my list
            </button>
            <a href={`/u/${handle}`} className="self-center text-sm text-muted">
              Cancel
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline gap-3">
        <span className="rank-num text-3xl text-accent">{n}</span>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </li>
  );
}
