"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListKind } from "@/db/schema";
import { previewImport, saveImport, type PreviewResult } from "./actions";

export function ImportClient({ kind, handle }: { kind: ListKind; handle: string }) {
  const router = useRouter();
  const [isMac, setIsMac] = useState(true);
  const [text, setText] = useState("");
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
        if (res.tracks.length === 0) {
          setError(
            res.playlists
              ? "That's a playlist link. Spotify won't let apps read other people's playlists, so copy the songs themselves (steps above)."
              : "No song links found. Follow the steps above and paste again.",
          );
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
      <ol className="grid gap-3 sm:grid-cols-2">
        <Step n={1} title="Open the Spotify desktop app">
          On a computer, open the playlist with your list. (Phone can&apos;t copy a whole playlist; see below.)
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
            className="rounded-full border border-line px-4 py-2 text-sm disabled:opacity-40"
          >
            {pending ? "Reading…" : "Read links"}
          </button>
          <span className="text-xs text-muted">
            On your phone instead? In Spotify tap ••• on a song → Share → Copy link, and paste here one at a time.
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>

      {preview && preview.tracks.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5">
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
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => save("replace")}
              disabled={pending}
              className="rounded-full bg-accent px-5 py-2 font-medium text-black disabled:opacity-50"
            >
              Save as my {kind === "on_deck" ? "On Deck" : "All-Time"} list
            </button>
            <button
              type="button"
              onClick={() => save("append")}
              disabled={pending}
              className="rounded-full border border-line px-5 py-2 disabled:opacity-50"
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
