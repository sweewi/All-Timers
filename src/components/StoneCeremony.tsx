"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setInStone } from "@/app/me/actions";
import { ShareSheet } from "./ShareSheet";

/**
 * Setting a list in stone. It's a label, not a lock, so the moment has to carry the
 * weight: the screen goes still, a slab rises, the words are cut into it letter by
 * letter with chips of stone flying, and a gold seal comes down with the date.
 */

const WORDS = "SET IN STONE";

export function StoneCeremony({ count, cover }: { count: number; cover: string | null }) {
  const [phase, setPhase] = useState<"idle" | "ask" | "carve" | "done">("idle");
  const [result, setResult] = useState<{ setAt: string; count: number; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const doneBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "carve") close();
    };
    document.documentElement.classList.add("stone-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("stone-open");
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only depends on state setters
  }, [phase]);

  useEffect(() => {
    if (phase !== "carve") return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setPhase("done"), still ? 0 : 3600);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "done") doneBtn.current?.focus();
  }, [phase]);

  function close() {
    const wasDone = phase === "done";
    setPhase("idle");
    setError(null);
    if (wasDone) router.refresh();
  }

  const go = () =>
    start(async () => {
      setError(null);
      const r = await setInStone();
      if (!r.ok) return setError(r.message);
      setResult(r);
      setPhase("carve");
    });

  const date = result ? new Date(result.setAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <>
      <button type="button" className="btn btn-gold" onClick={() => setPhase("ask")}>
        Set it in stone
      </button>
      {phase !== "idle" &&
        createPortal(
          <div className={`stone stone-${phase}`} role="dialog" aria-modal aria-label="Set my list in stone">
            {phase === "ask" && (
              <div className="stone-ask">
                <h2>Set {count} songs in stone?</h2>
                <p>
                  This says the list is done: the songs that made it, in the order they belong. The seal goes on the column for
                  everyone to see.
                </p>
                <p className="stone-fine">
                  It&apos;s a label, not a lock. A song can still earn its way on later, and when one does, the group hears about it.
                </p>
                {error && <p className="stone-error">{error}</p>}
                <div className="stone-actions">
                  <button type="button" className="btn btn-gold btn-lg" onClick={go} disabled={pending}>
                    {pending ? "Cutting the stone…" : "Set it in stone"}
                  </button>
                  <button type="button" className="btn btn-link" onClick={close}>
                    Not yet
                  </button>
                </div>
              </div>
            )}
            {(phase === "carve" || phase === "done") && result && (
              <div className="stone-stage">
                <div className="stone-slab">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="stone-cover" />
                  )}
                  <p className="stone-words" aria-label={WORDS}>
                    {[...WORDS].map((ch, i) => (
                      <span key={i} className="stone-letter" style={{ ["--i" as string]: i }} aria-hidden>
                        {ch === " " ? " " : ch}
                        {ch !== " " && (
                          <span className="stone-chips">
                            {[0, 1, 2, 3].map((k) => (
                              <i key={k} style={{ ["--k" as string]: k }} />
                            ))}
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                  <p className="stone-meta">
                    {result.count} songs · {date}
                  </p>
                  <span className="stone-seal" aria-hidden>
                    <svg viewBox="0 0 100 100">
                      <defs>
                        <path id="seal-ring" d="M50,50 m-34,0 a34,34 0 1,1 68,0 a34,34 0 1,1 -68,0" />
                      </defs>
                      <text>
                        <textPath href="#seal-ring" startOffset="0">
                          ALL·TIMERS · FOR LIFE · ALL·TIMERS · FOR LIFE ·
                        </textPath>
                      </text>
                    </svg>
                    <b>{new Date(result.setAt).getFullYear()}</b>
                  </span>
                </div>
                {phase === "done" && (
                  <div className="stone-after">
                    <p>It&apos;s official. Tell the group, or make a card to show it off.</p>
                    <ShareSheet
                      path={`/s/${result.token}`}
                      label="Tell the group"
                      message={`My All-Timers are set in stone. ${result.count} songs, for life:`}
                    />
                    <div className="stone-actions">
                      <Link href="/me/share" className="btn btn-marble btn-sm">
                        Make my card
                      </Link>
                      <button ref={doneBtn} type="button" className="btn btn-link" onClick={close}>
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
