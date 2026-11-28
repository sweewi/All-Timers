"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveCard, setSharing, shareLink } from "@/app/me/actions";
import { ShareSheet } from "@/components/ShareSheet";
import type { CardLayout, CardStyle, CardTheme } from "@/lib/profile";

const THEMES: { id: CardTheme; label: string; swatch: string }[] = [
  { id: "marble", label: "Marble", swatch: "linear-gradient(160deg, #fdfaf3, #ddd4c1)" },
  { id: "cobalt", label: "Cobalt", swatch: "linear-gradient(160deg, #2b4be0, #0b165e)" },
  { id: "dusk", label: "Dusk", swatch: "linear-gradient(180deg, #ffc08f, #e9718a, #2f1a63)" },
  { id: "sand", label: "Sand", swatch: "linear-gradient(160deg, #f6d3a8, #b9532f)" },
  { id: "olive", label: "Olive", swatch: "linear-gradient(160deg, #4a5a35, #1b2313)" },
];
const LAYOUTS: { id: CardLayout; label: string; note: string }[] = [
  { id: "top5", label: "Top 5", note: "#1 framed, the next four" },
  { id: "number1", label: "Number one", note: "one song and why" },
  { id: "wall", label: "The wall", note: "every cover" },
  { id: "top10", label: "Top 10", note: "the first ten" },
];
type Format = "story" | "square";

/** Pick a look for the list's card, see it drawn, then save, download or send it. */
export function CardStudio({ name, initial, token: initialToken }: { name: string; initial: CardStyle; token: string | null }) {
  const [style, setStyle] = useState<CardStyle>(initial);
  const [saved, setSaved] = useState<CardStyle>(initial);
  const [format, setFormat] = useState<Format>("story");
  const [headline, setHeadline] = useState(initial.headline);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(initialToken);
  const [msg, setMsg] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [pending, start] = useTransition();

  // headline changes are drawn after typing pauses
  useEffect(() => {
    const t = setTimeout(() => setStyle((s) => ({ ...s, headline })), 500);
    return () => clearTimeout(t);
  }, [headline]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature check after hydration
    setCanShareFiles(typeof navigator !== "undefined" && "canShare" in navigator && navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] }));
  }, []);

  const src = useMemo(() => {
    const q = new URLSearchParams({ format, theme: style.theme, layout: style.layout, headline: style.headline, rules: style.showRules ? "1" : "0" });
    return `/me/share/card?${q}`;
  }, [format, style]);
  // a new picture is loading whenever the address changes
  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setLoading(true);
  }

  const dirty = JSON.stringify(saved) !== JSON.stringify(style);
  const file = `all-timers-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format}.png`;

  const shareImage = () =>
    start(async () => {
      setMsg(null);
      try {
        const blob = await (await fetch(src)).blob();
        await navigator.share({ files: [new File([blob], file, { type: "image/png" })] });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setMsg("Couldn't open sharing. Download the image instead.");
      }
    });

  return (
    <div className="studio mt-8">
      <div className="studio-preview">
        <div className={`studio-frame studio-${format} ${loading ? "is-loading" : ""}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`${name}'s All-Timers card`} onLoad={() => setLoading(false)} onError={() => setLoading(false)} />
        </div>
      </div>

      <div className="studio-controls">
        <fieldset>
          <legend>Size</legend>
          <div className="studio-seg">
            {(["story", "square"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>
                {f === "story" ? "Story (9:16)" : "Square"}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Look</legend>
          <div className="studio-swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={style.theme === t.id}
                onClick={() => setStyle({ ...style, theme: t.id })}
                style={{ ["--sw" as string]: t.swatch }}
              >
                <span aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Layout</legend>
          <div className="studio-layouts">
            {LAYOUTS.map((l) => (
              <button key={l.id} type="button" aria-pressed={style.layout === l.id} onClick={() => setStyle({ ...style, layout: l.id })}>
                <b>{l.label}</b>
                <small>{l.note}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Headline</legend>
          <input className="field" maxLength={48} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={`${name}'s All-Timers`} />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={style.showRules} onChange={(e) => setStyle({ ...style, showRules: e.target.checked })} />
            Show my rules on the card
          </label>
        </fieldset>

        <div className="studio-actions">
          <button
            type="button"
            className="btn btn-gold"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const next = await saveCard(style);
                setSaved(next);
                setMsg("Saved. Shared links now show this card.");
              })
            }
          >
            {dirty ? "Save as my card" : "Saved"}
          </button>
          {canShareFiles && (
            <button type="button" className="btn btn-marble" onClick={shareImage} disabled={pending}>
              Share image
            </button>
          )}
          <a className="btn btn-marble" href={`${src}&download=1`} download={file}>
            Download
          </a>
        </div>
        {msg && <p className="text-sm">{msg}</p>}

        <div className="note note-blue">
          <b>Share the list itself</b>
          <p className="mt-1 text-sm">
            A link anyone can open: the songs in order, the whys and the rules. No play counts, and no one else&apos;s names. In a group chat it
            shows up as the card.
          </p>
          {token ? (
            <>
              <ShareSheet className="mt-3" path={`/s/${token}`} label="Share my list" message={`My All-Timers:`} />
              <p className="mt-3 flex flex-wrap gap-3 text-sm">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() =>
                    start(async () => {
                      await setSharing(true);
                      setToken(await shareLink());
                      setMsg("New link made. The old one no longer works.");
                    })
                  }
                >
                  Make a new link
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() =>
                    start(async () => {
                      await setSharing(false);
                      setToken(null);
                      setMsg("The public link is off.");
                    })
                  }
                >
                  Turn the link off
                </button>
              </p>
            </>
          ) : (
            <button type="button" className="btn btn-gold btn-sm mt-3" disabled={pending} onClick={() => start(async () => setToken(await shareLink()))}>
              Make a share link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
