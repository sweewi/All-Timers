"use client";

import { useEffect } from "react";

/**
 * The one world every page lives in. It sits in the root layout and never unmounts, so
 * moving between pages moves one camera. Altitude (`--alt`, 0 = standing on the sand,
 * 1 = high in the deep blue with stars) is the only thing pages change.
 *
 * Scroll sets the altitude directly (so the ground and the page never drift apart);
 * arriving on a new page glides the camera there with a CSS transition on the
 * registered `--alt` property.
 */

/** A point on a page's flight path: at this scroll position, the camera is at `alt`.
 *  `y` is in screen heights from the top, or "end" (minus `back` screens). */
export type Stop = { y: number | "end"; back?: number; alt: number };

let arrived = false;

export function Altitude({ stops, base = 0.3, range = 0 }: { stops?: Stop[]; base?: number; range?: number }) {
  // a room drifts by `range` over six screens, so a short page barely moves the sky
  const key = JSON.stringify(stops ?? [{ y: 0, alt: base }, { y: 6, alt: base + range }]);
  useEffect(() => {
    const path: Stop[] = JSON.parse(key);
    const root = document.documentElement;
    let raf = 0;
    const at = () => {
      const vh = window.innerHeight;
      const max = Math.max(1, root.scrollHeight - vh);
      const pts = path
        .map((p) => ({ px: p.y === "end" ? max - (p.back ?? 0) * vh : p.y * vh, alt: p.alt }))
        .map((p) => ({ ...p, px: Math.min(max, Math.max(0, p.px)) }))
        .sort((a, b) => a.px - b.px);
      const y = window.scrollY;
      if (y <= pts[0].px) return pts[0].alt;
      for (let i = 1; i < pts.length; i++) {
        if (y <= pts[i].px) {
          const a = pts[i - 1], b = pts[i];
          const t = b.px === a.px ? 1 : (y - a.px) / (b.px - a.px);
          return a.alt + (b.alt - a.alt) * t;
        }
      }
      return pts[pts.length - 1].alt;
    };
    const set = () => {
      raf = 0;
      root.style.setProperty("--alt", Math.min(1, Math.max(0, at())).toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(set);
    };
    // glide on arrival from another page; jump on the very first load
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (arrived) {
      root.classList.add("glide");
      timer = setTimeout(() => root.classList.remove("glide"), 1500);
    }
    arrived = true;
    set();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const ro = new ResizeObserver(onScroll);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro.disconnect();
    };
  }, [key]);
  return null;
}

const A = (n: string) => `/monument/${n}.webp`;

/** Clouds live at an altitude: they pass the middle of the screen when the camera reaches it. */
const CLOUDS: { src: string; a: number; x: number; w: number; o: number; speed?: number }[] = [
  { src: "cloud-c", a: 0.16, x: -18, w: 70, o: 0.75 },
  { src: "cloud-b", a: 0.24, x: 58, w: 62, o: 0.85 },
  { src: "cloud-a", a: 0.36, x: -8, w: 80, o: 0.95 },
  { src: "cloud-c", a: 0.47, x: 48, w: 74, o: 0.95 },
  { src: "cloud-b", a: 0.58, x: -24, w: 76, o: 0.9 },
  { src: "cloud-a", a: 0.68, x: 52, w: 66, o: 0.85 },
  { src: "cloud-c", a: 0.8, x: 4, w: 60, o: 0.55 },
];

export function World() {
  return (
    <>
    <div className="world" aria-hidden>
      <div className="world-sky" />
      <div className="world-stars" />
      <div className="world-sun" />
      <div className="world-far">
        {/* a giant marble head looking down from high in the sky: the gods, indifferent */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A("head")} alt="" className="world-head" />
      </div>
      {CLOUDS.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={A(c.src)}
          alt=""
          className="world-cloud"
          style={{ left: `${c.x}vw`, width: `${c.w}vw`, opacity: c.o, ["--a" as string]: c.a, animationDelay: `${-i * 7}s` }}
        />
      ))}
      <div className="world-orbs">
        {[
          { a: 0.12, x: 82, s: 7, d: 0 },
          { a: 0.3, x: 9, s: 4.5, d: -3 },
          { a: 0.52, x: 88, s: 10, d: -6 },
          { a: 0.74, x: 14, s: 6, d: -2 },
        ].map((o, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={A("sphere")}
            alt=""
            className="world-orb"
            style={{ left: `${o.x}vw`, width: `${o.s}vw`, ["--a" as string]: o.a, animationDelay: `${o.d}s` }}
          />
        ))}
      </div>
      <div className="world-birds">
        {[0, 1, 2].map((f) => (
          <svg key={f} className={`mon-flock mon-flock-${f}`} viewBox="0 0 120 50">
            {[
              [10, 30, 1], [28, 22, 0.8], [44, 34, 0.9], [60, 18, 0.7], [76, 28, 0.85], [96, 20, 0.6],
            ].map(([x, y, sc], i) => (
              <path
                key={i}
                className="mon-bird"
                style={{ animationDelay: `${i * 0.13}s` }}
                transform={`translate(${x} ${y}) scale(${sc})`}
                d="M-6 0 Q-3 -3 0 0 Q3 -3 6 0"
              />
            ))}
          </svg>
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={A("plate2")} alt="" className="world-ground" />
    </div>
    {/* one finishing pass over everything, so renders and photographs read as one picture */}
    <div className="world-finish" aria-hidden>
      <div className="world-rays" />
      <div className="world-grade" />
      <div className="world-grain" />
    </div>
    </>
  );
}
