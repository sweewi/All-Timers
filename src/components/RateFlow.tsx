"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rateSong, saveTake } from "@/app/rate/actions";
import { BANDS, maxQuestions, searchDone, searchMid, searchStep, searchTie, startSearch, type Search } from "@/lib/rating-math";
import type { RatingBucket } from "@/db/schema";

/**
 * Rating, Beli-style: a gut bucket first, then a few head-to-heads against songs already
 * in that bucket until the new one finds its place. One host lives in the layout; any
 * "Rate" button anywhere opens it with a window event, so lists, cards and feeds don't
 * each carry the whole flow.
 */

export type RateSong = { id: string; name: string; artists: string; imageUrl: string | null };
type Rival = RateSong & { score: number };
const EVENT = "alltimers:rate";

export function openRating(song: RateSong) {
  window.dispatchEvent(new CustomEvent<RateSong>(EVENT, { detail: song }));
}

type Step =
  | { at: "bucket" }
  | { at: "loading"; bucket: RatingBucket }
  | { at: "duel"; bucket: RatingBucket; rivals: Rival[]; search: Search; max: number }
  | { at: "saving" }
  | { at: "done"; score: number; rank: number; total: number; bucket: RatingBucket }
  | { at: "error"; message: string };

export function RateFlowHost() {
  const [song, setSong] = useState<RateSong | null>(null);
  const [step, setStep] = useState<Step>({ at: "bucket" });
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onRate = (e: Event) => {
      const detail = (e as CustomEvent<RateSong>).detail;
      if (!detail?.id) return;
      setSong(detail);
      setStep({ at: "bucket" });
    };
    window.addEventListener(EVENT, onRate);
    return () => window.removeEventListener(EVENT, onRate);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (song && !d.open) d.showModal();
    if (!song && d.open) d.close();
  }, [song]);

  const close = useCallback(() => {
    setSong(null);
    router.refresh();
  }, [router]);

  const place = useCallback(
    async (bucket: RatingBucket, rivals: Rival[], lo: number, comparisons: number) => {
      if (!song) return;
      setStep({ at: "saving" });
      try {
        const r = await rateSong({
          trackId: song.id,
          bucket,
          above: rivals[lo - 1]?.id ?? null,
          below: rivals[lo]?.id ?? null,
          comparisons,
        });
        setStep(r.ok ? { at: "done", score: r.score, rank: r.rank, total: r.total, bucket } : { at: "error", message: r.message });
      } catch {
        setStep({ at: "error", message: "That didn't save. Check the connection and try again." });
      }
    },
    [song],
  );

  const chooseBucket = useCallback(
    async (bucket: RatingBucket) => {
      if (!song) return;
      setStep({ at: "loading", bucket });
      try {
        const res = await fetch(`/api/ratings/bucket?b=${bucket}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { songs } = (await res.json()) as { songs: Rival[] };
        const rivals = songs.filter((s) => s.id !== song.id);
        if (!rivals.length) return place(bucket, rivals, 0, 0);
        setStep({ at: "duel", bucket, rivals, search: startSearch(rivals.length), max: maxQuestions(rivals.length) });
      } catch {
        setStep({ at: "error", message: "Couldn't load the songs to compare against. Try again in a moment." });
      }
    },
    [song, place],
  );

  const answer = useCallback(
    (kind: "new" | "old" | "tie" | "skip") => {
      if (step.at !== "duel") return;
      let s = step.search;
      if (kind === "skip") s = { lo: searchMid(s), hi: searchMid(s), asked: s.asked };
      else if (kind === "tie") s = searchTie(s);
      else s = searchStep(s, kind === "new");
      if (searchDone(s)) place(step.bucket, step.rivals, s.lo, s.asked);
      else setStep({ ...step, search: s });
    },
    [step, place],
  );

  // keyboard: ← picks the new song, → the old one, ↓ too close to call
  useEffect(() => {
    if (step.at !== "duel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") answer("new");
      else if (e.key === "ArrowRight") answer("old");
      else if (e.key === "ArrowDown") answer("tie");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step.at, answer]);

  return (
    <dialog
      ref={dialog}
      className="rate-dialog"
      aria-label={song ? `Rate ${song.name}` : "Rate a song"}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {song && (
        <div className="rate-sheet">
          <button type="button" className="rate-close" onClick={close} aria-label="Close">
            ×
          </button>
          {step.at === "bucket" && <BucketStep song={song} onPick={chooseBucket} />}
          {(step.at === "loading" || step.at === "saving") && <p className="rate-wait">{step.at === "loading" ? "Finding songs to compare…" : "Placing it…"}</p>}
          {step.at === "duel" && <Duel song={song} step={step} onAnswer={answer} />}
          {step.at === "done" && <Result song={song} {...step} onClose={close} onRedo={() => setStep({ at: "bucket" })} />}
          {step.at === "error" && (
            <div className="rate-error">
              <p>{step.message}</p>
              <button type="button" className="btn btn-marble btn-sm" onClick={() => setStep({ at: "bucket" })}>
                Start over
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

function Cover({ song, size = 200 }: { song: RateSong; size?: number }) {
  return song.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={song.imageUrl} alt="" width={size} height={size} className="rate-cover" />
  ) : (
    <span className="rate-cover rate-cover-blank" style={{ width: size, height: size }} aria-hidden />
  );
}

function BucketStep({ song, onPick }: { song: RateSong; onPick: (b: RatingBucket) => void }) {
  return (
    <div className="rate-bucket">
      <Cover song={song} size={168} />
      <h2>{song.name}</h2>
      <p className="rate-artist">{song.artists}</p>
      <p className="rate-q">Gut reaction first.</p>
      <div className="rate-buckets">
        {(["loved", "fine", "disliked"] as const).map((b) => (
          <button key={b} type="button" className={`rate-b rate-b-${b}`} onClick={() => onPick(b)}>
            <span className="rate-b-label">{BANDS[b].label}</span>
            <span className="rate-b-band">
              {BANDS[b].lo.toFixed(1)}–{BANDS[b].hi.toFixed(1)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Duel({
  song,
  step,
  onAnswer,
}: {
  song: RateSong;
  step: Extract<Step, { at: "duel" }>;
  onAnswer: (k: "new" | "old" | "tie" | "skip") => void;
}) {
  const rival = step.rivals[searchMid(step.search)];
  const n = step.search.asked + 1;
  return (
    <div className="duel">
      <p className="duel-ask">{BANDS[step.bucket].ask}</p>
      <div className="duel-stage" key={rival.id}>
        <button type="button" className="duel-card" onClick={() => onAnswer("new")}>
          <Cover song={song} size={172} />
          <span className="duel-plinth" aria-hidden />
          <b>{song.name}</b>
          <span>{song.artists}</span>
        </button>
        <span className="duel-or" aria-hidden>
          or
        </span>
        <button type="button" className="duel-card" onClick={() => onAnswer("old")}>
          <Cover song={rival} size={172} />
          <span className="duel-plinth" aria-hidden />
          <b>{rival.name}</b>
          <span>
            {rival.artists} · {rival.score.toFixed(1)}
          </span>
        </button>
      </div>
      <div className="duel-foot">
        <button type="button" className="btn btn-marble btn-sm" onClick={() => onAnswer("tie")}>
          Too close to call
        </button>
        <span className="duel-progress" aria-live="polite">
          Question {n} of at most {step.max}
        </span>
        <button type="button" className="btn-link text-sm" onClick={() => onAnswer("skip")}>
          Skip the rest
        </button>
      </div>
    </div>
  );
}

function Result({
  song,
  score,
  rank,
  total,
  bucket,
  onClose,
  onRedo,
}: {
  song: RateSong;
  score: number;
  rank: number;
  total: number;
  bucket: RatingBucket;
  onClose: () => void;
  onRedo: () => void;
}) {
  const shown = useCountUp(score);
  const [take, setTake] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  return (
    <div className="rate-result">
      <Cover song={song} size={120} />
      <div className={`rate-score rate-score-${bucket}`} aria-label={`Scored ${score.toFixed(1)} out of 10`}>
        {shown.toFixed(1)}
      </div>
      <p className="rate-rank">
        <b>{song.name}</b> lands at #{rank} of {total} rated.
      </p>
      <form
        className="rate-take"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!take.trim()) return onClose();
          setSaved("saving");
          try {
            await saveTake(song.id, take);
            setSaved("saved");
            onClose();
          } catch {
            setSaved("error");
          }
        }}
      >
        <label htmlFor="rate-take">Add a take for the group (optional)</label>
        <div className="flex gap-2">
          <input id="rate-take" className="field" maxLength={280} value={take} onChange={(e) => setTake(e.target.value)} placeholder="The bridge alone is a 10." />
          <button type="submit" className="btn btn-gold" disabled={saved === "saving"}>
            {take.trim() ? "Post take" : "Done"}
          </button>
        </div>
        {saved === "error" && <p className="text-sm text-[#a2432f]">The take didn&apos;t save. Try again.</p>}
      </form>
      <button type="button" className="btn-link text-sm" onClick={onRedo}>
        Rate it again
      </button>
    </div>
  );
}

function useCountUp(target: number) {
  const [still] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [v, setV] = useState(0);
  useEffect(() => {
    if (still) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, still]);
  return still ? target : v;
}

/** A small button that opens the rating flow for one song, showing the score once it has one. */
export function RateButton({ song, score, className = "" }: { song: RateSong; score?: number | null; className?: string }) {
  return (
    <button
      type="button"
      className={`rate-chip ${score != null ? "is-rated" : ""} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openRating(song);
      }}
      aria-label={score != null ? `Rated ${score.toFixed(1)}. Change rating for ${song.name}` : `Rate ${song.name}`}
    >
      {score != null ? (
        <>
          <span className="rate-chip-k">mine</span> {score.toFixed(1)}
        </>
      ) : (
        "Rate"
      )}
    </button>
  );
}
