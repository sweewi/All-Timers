"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import WORLD from "@/lib/world-manifest.json";
import type { GroundMember } from "./Grounds";
import { promenadeScreens } from "@/lib/promenade";

type Mini = { key: string; height: number; w: number; h: number; cover: [number, number, number, number]; ground: number; px: number };
const MINIS: Mini[] = Object.entries(WORLD as Record<string, Record<string, unknown>>)
  .filter(([k]) => k.startsWith("mini-"))
  .map(([k, v]) => ({ key: k, height: parseFloat(k.slice(5).replace("_", ".")), ...(v as Omit<Mini, "key" | "height">) }))
  .sort((a, b) => a.height - b.height);

/**
 * The plaza as a walk. The section pins, and scrolling down walks you sideways along a
 * line of everyone's columns: front and back rows staggered so it reads as a real place
 * with depth, the far plain sliding slower than the columns. Once you reach the end of
 * the line, the page lets go and you lift off into the sky.
 */
export function Promenade({
  members,
  ghosts,
  children,
}: {
  members: GroundMember[];
  ghosts: number;
  children?: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const screens = promenadeScreens(members.length + ghosts);

  useEffect(() => {
    const el = root.current, r = row.current;
    if (!el || !r) return;
    const html = document.documentElement;
    let raf = 0;
    const set = () => {
      raf = 0;
      const total = el.offsetHeight - window.innerHeight;
      const y = window.scrollY - el.offsetTop;
      const p = total > 0 ? Math.min(1, Math.max(0, y / total)) : 0;
      const travel = Math.max(0, r.scrollWidth - window.innerWidth);
      r.style.transform = `translate3d(${-p * travel}px, 0, 0)`;
      html.style.setProperty("--pan", p.toFixed(4));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(set);
    };
    set();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      html.style.removeProperty("--pan");
    };
  }, []);

  const maxCount = Math.max(1, ...members.map((m) => m.count));
  const slots: (GroundMember | null)[] = [...members, ...Array.from({ length: ghosts }, () => null)];

  return (
    <section ref={root} className="promenade" style={{ height: `calc(100svh + ${screens * 100}vh)` }} aria-label="Everyone's columns">
      <div className="promenade-stage">
        {children}
        <div ref={row} className="promenade-row">
          {slots.map((m, i) => {
            const tall = m ? m.count / maxCount : 0.3;
            const mini = MINIS[Math.min(MINIS.length - 1, Math.floor(tall * MINIS.length * 0.999))];
            if (!mini) return null;
            // staggered rows: every other column stands further back
            const back = i % 2 === 1;
            const d = back ? 0.72 : 1;
            const k = 5.4 * d; // vh per metre
            const H = (mini.h / mini.px) * k;
            const W = (mini.w / mini.px) * k;
            const groundY = back ? 70 : 81; // vh
            const [cx, cy, cw, ch] = mini.cover;
            const style = {
              ["--W" as string]: `${W}vh`,
              top: `${groundY - (mini.ground / mini.px) * k}vh`,
              width: `${W}vh`,
              height: `${H}vh`,
              zIndex: back ? 1 : 2,
              ["--bob" as string]: `${(i * 0.7) % 3}s`,
            } as React.CSSProperties;
            const inner = (
              <>
                <span className="mini-shadow" style={{ top: `${((mini.ground / mini.h) * 100).toFixed(2)}%` }} />
                <span
                  className="mini-cover"
                  style={{ left: `${(cx / mini.w) * 100}%`, top: `${(cy / mini.h) * 100}%`, width: `${(cw / mini.w) * 100}%`, height: `${(ch / mini.h) * 100}%` }}
                >
                  {m?.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.cover} alt="" />
                  ) : (
                    <span className="mini-empty">?</span>
                  )}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/monument/${mini.key}.webp`} alt="" className="mini-sprite" />
                <span className="mini-label" style={{ top: `${((mini.ground / mini.h) * 100).toFixed(2)}%` }}>
                  {m ? (
                    <>
                      <b style={{ ["--c" as string]: m.color }}>{m.name}</b>
                      <small>{m.count ? (m.setInStone ? `${m.count} songs · set in stone` : `${m.count} songs · climb it`) : "no list yet"}</small>
                    </>
                  ) : (
                    <>
                      <b>A friend</b>
                      <small>invite them</small>
                    </>
                  )}
                </span>
              </>
            );
            return (
              <div key={m?.handle ?? `ghost-${i}`} className={`promenade-slot ${back ? "is-back" : ""}`}>
                {m ? (
                  <Link href={`/u/${m.handle}`} className={`mini ${m.setInStone ? "is-stone" : ""}`} style={style} aria-label={`${m.name}'s column, ${m.count} songs`}>
                    {inner}
                  </Link>
                ) : (
                  <a href="#invite" className="mini mini-ghost" style={style} aria-label="Invite a friend">
                    {inner}
                  </a>
                )}
              </div>
            );
          })}
        </div>
        {slots.length > 2 && (
          <div className="promenade-hint" aria-hidden>
            <span>Keep scrolling to walk the plaza</span>
            <i />
          </div>
        )}
      </div>
    </section>
  );
}
