"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PIECES, PX_PER_M, baseFor, carvedTitle, roman, sliceFor, type Rect } from "@/lib/monument";

export type MonumentSong = {
  id: string;
  rank: number;
  name: string;
  artists: string;
  album: string;
  year: number | null;
  imageUrl: string | null;
  love: string | null;
  moment: string | null;
  found: string | null;
  memory: string | null;
};

const ASSET = (name: string) => `/monument/${name}.webp`;

/** Desktop shows the whole 3.9 m slice; phones crop to the column plus its right ledge. */
const MOBILE_BREAK = 720;
const MOBILE_X0_M = -0.98; // crop window in meters, relative to the column center
const MOBILE_W_M = 2.95;

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function Monument({
  person,
  songs,
  isMe,
  storyHref,
  toolbar,
}: {
  person: { name: string; handle: string };
  songs: MonumentSong[];
  isMe: boolean;
  storyHref: string;
  toolbar?: React.ReactNode;
}) {
  const [vw, setVw] = useState(1200);
  const [open, setOpen] = useState<MonumentSong | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useLayoutEffect(() => {
    const onResize = () => setVw(document.documentElement.clientWidth);
     
    onResize();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the motion preference once after mount
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mobile = vw < MOBILE_BREAK;
  // scale from source pixels to CSS pixels, and the horizontal crop on phones
  const s = mobile ? vw / (MOBILE_W_M * PX_PER_M) : Math.min(1180, vw) / PIECES.crown.w;
  const cropX = mobile ? (MOBILE_X0_M + 1.95) * PX_PER_M * s : 0;
  const viewW = mobile ? vw : PIECES.crown.w * s;

  const top = songs[0];
  const rest = songs.slice(1);
  const slices = useMemo(
    () => rest.map((song) => sliceFor(song.rank, songs.length, mobile || song.rank % 2 === 0 ? "R" : "L")),
    [rest, songs.length, mobile],
  );
  const base = baseFor(slices.length ? slices[slices.length - 1] : null);

  // One scroll loop drives everything: altitude (--p), parallax (--sy) and focus.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      const root = document.documentElement;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      const el = rootRef.current;
      if (!el) return;
      el.style.setProperty("--p", p.toFixed(4));
      el.style.setProperty("--sy", `${window.scrollY}px`);
      el.style.setProperty("--sky-high", (1 - smooth(0.1, 0.4, p)).toFixed(3));
      el.style.setProperty("--sky-mid", (1 - smooth(0.8, 0.92, p)).toFixed(3));
      el.style.setProperty("--rays", (Math.pow(1 - smooth(0, 0.55, p), 1.4) * 0.75).toFixed(3));
      el.style.setProperty("--birds", (smooth(0.08, 0.2, p) * (1 - smooth(0.6, 0.75, p))).toFixed(3));
      el.style.setProperty("--warm", (0.85 - 0.55 * p).toFixed(3));
      const vh = window.innerHeight;
      for (const r of rows.current) {
        if (!r) continue;
        const b = r.getBoundingClientRect();
        if (b.bottom < -vh || b.top > 2 * vh) continue;
        const d = Math.abs(b.top + b.height * 0.42 - vh / 2) / vh;
        const focus = 1 - smooth(0.22, 0.7, d);
        r.style.setProperty("--focus", focus.toFixed(3));
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [s]);

  const px = (v: number) => `${v * s}px`;
  const place = (r: Rect, extra?: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    left: px(r[0]),
    top: px(r[1]),
    width: px(r[2]),
    height: px(r[3]),
    ...extra,
  });

  const crown = PIECES.crown;
  const baseP = PIECES[base];
  const skyPad = mobile ? 180 : 260;

  return (
    <div ref={rootRef} className={`monument ${reduced ? "monument-still" : ""}`} style={{ ["--s" as string]: s }}>
      {/* the sky and garden behind everything */}
      <div className="mon-bg" aria-hidden>
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("garden")})` }} />
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("sky-mid")})`, opacity: "var(--sky-mid)" }} />
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("sky-high")})`, opacity: "var(--sky-high)" }} />
        <div className="mon-warm" />
        <div className="mon-rays" />
        <Birds />
      </div>

      {/* clouds drifting around the top of the column, at different depths */}
      <div className="mon-clouds" aria-hidden>
        <Cloud src="cloud-a" top={20} left="-18vw" width="70vw" depth={0.35} opacity={0.95} />
        <Cloud src="cloud-b" top={skyPad + crown.h * s * 0.5} left="52vw" width="62vw" depth={0.25} opacity={0.9} />
        <Cloud src="cloud-c" top={skyPad + crown.h * s * 1.3} left="-22vw" width="60vw" depth={0.18} opacity={0.8} />
        <Cloud src="cloud-a" top={skyPad + crown.h * s * 2.4} left="58vw" width="55vw" depth={0.12} opacity={0.55} />
      </div>

      <div className="relative mx-auto" style={{ width: viewW, overflowX: "clip" }}>

        <header className="relative z-10 pt-24 text-center" style={{ height: skyPad }}>
          <p className="mon-kicker">All-Timers</p>
          <h1 className="mon-name">{person.name}</h1>
          <p className="mon-sub">
            {songs.length} {songs.length === 1 ? "song" : "songs"} · scroll down to go deeper
          </p>
          {toolbar && <div className="mt-4 flex flex-wrap justify-center gap-2">{toolbar}</div>}
        </header>

        {top && (
          <section
            ref={(el) => {
              rows.current[0] = el as HTMLDivElement;
            }}
            className="mon-row relative"
            style={{ height: Math.floor(crown.h * s) }}
          >
            <div className="absolute top-0" style={{ left: -cropX, width: crown.w * s, height: crown.h * s }}>
              <Cover song={top} rect={crown.cover!} place={place} onOpen={setOpen} big />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ASSET("crown")} alt="" className="mon-piece" style={{ width: crown.w * s }} fetchPriority="high" />
              {crown.abacus && (
                <div className="mon-carved mon-roman" style={place(crown.abacus, { fontSize: px(crown.abacus[3] * 0.62) })}>
                  {person.name}
                </div>
              )}
              {crown.band && (
                <button type="button" onClick={() => setOpen(top)} className="mon-carved mon-band" style={place(crown.band)}>
                  <span className="mon-title" style={{ fontSize: px(crown.band[3] * 0.34) }}>{carvedTitle(top.name)}</span>
                  <span className="mon-artist" style={{ fontSize: px(crown.band[3] * 0.2) }}>{top.artists}</span>
                </button>
              )}
            </div>
          </section>
        )}

        {rest.map((song, i) => {
          const name = slices[i];
          const piece = PIECES[name];
          if (!piece) return null;
          return (
            <section
              key={song.id}
              ref={(el) => {
                rows.current[i + 1] = el as HTMLDivElement;
              }}
              className="mon-row relative"
              style={{ height: Math.floor(piece.h * s) }}
            >
              <div className="absolute top-0" style={{ left: -cropX, width: piece.w * s, height: piece.h * s }}>
                <Cover song={song} rect={piece.cover!} place={place} onOpen={setOpen} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ASSET(name)} alt="" className="mon-piece" style={{ width: piece.w * s }} loading={i < 3 ? "eager" : "lazy"} />
                {piece.tablet && (
                  <button
                    type="button"
                    onClick={() => setOpen(song)}
                    className="mon-carved mon-tablet"
                    style={place(piece.tablet)}
                    aria-label={`#${song.rank} ${song.name} by ${song.artists}`}
                  >
                    <span className="mon-numeral" style={{ fontSize: px(piece.tablet[3] * 0.5) }}>
                      {roman(song.rank)}
                    </span>
                    <span className="mon-lines">
                      <span className="mon-title" style={{ fontSize: px(piece.tablet[3] * 0.3) }}>{carvedTitle(song.name)}</span>
                      <span className="mon-artist" style={{ fontSize: px(piece.tablet[3] * 0.19) }}>{song.artists}</span>
                    </span>
                  </button>
                )}
              </div>
            </section>
          );
        })}

        {baseP && (
          <section className="relative z-[3]" style={{ height: Math.floor(baseP.h * s) }}>
            <div className="absolute top-0" style={{ left: -cropX, width: baseP.w * s, height: baseP.h * s }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ASSET(base)} alt="" className="mon-piece" style={{ width: baseP.w * s }} loading="lazy" />
              {baseP.plinth && (
                <div className="mon-carved mon-roman" style={place(baseP.plinth, { fontSize: px(baseP.plinth[3] * 0.32) })}>
                  {person.name}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      <div
        className="mon-ground"
        style={{
          marginTop: -Math.round(0.07 * PX_PER_M * s),
          ["--colx" as string]: mobile ? `${-MOBILE_X0_M * PX_PER_M * s}px` : "50%",
          ["--colw" as string]: `${1.6 * PX_PER_M * s}px`,
        }}
      >
        <div className="relative z-10 pt-[14vh] pb-12 text-center">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="mon-btn">
            Back up to #1
          </button>
          {isMe && (
            <Link href={storyHref} className="mon-btn ml-2">
              Say why they&apos;re here
            </Link>
          )}
        </div>
      </div>

      {open && <Plaque song={open} onClose={() => setOpen(null)} isMe={isMe} storyHref={storyHref} />}
    </div>
  );
}

function Cover({
  song,
  rect,
  place,
  onOpen,
  big = false,
}: {
  song: MonumentSong;
  rect: Rect;
  place: (r: Rect, extra?: React.CSSProperties) => React.CSSProperties;
  onOpen: (s: MonumentSong) => void;
  big?: boolean;
}) {
  // bleed a little under the frame so no sky shows at the edges
  const bleed = rect[2] * 0.02;
  const r: Rect = [rect[0] - bleed, rect[1] - bleed, rect[2] + 2 * bleed, rect[3] + 2 * bleed];
  return (
    <button type="button" onClick={() => onOpen(song)} className={`mon-cover ${big ? "mon-cover-big" : ""}`} style={place(r)}>
      {song.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={song.imageUrl} alt={`${song.name} cover`} loading={big ? "eager" : "lazy"} />
      ) : (
        <span className="block h-full w-full bg-stone-300" />
      )}
    </button>
  );
}

function Cloud({ src, top, left, width, depth, opacity }: { src: string; top: number; left: string; width: string; depth: number; opacity: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ASSET(src)}
      alt=""
      aria-hidden
      className="mon-cloud"
      style={{ top, left, width, opacity, ["--depth" as string]: depth }}
    />
  );
}

function Birds() {
  // small distant flocks crossing the sky now and then
  return (
    <div className="mon-birds">
      {[0, 1, 2].map((f) => (
        <svg key={f} className={`mon-flock mon-flock-${f}`} viewBox="0 0 120 50" aria-hidden>
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
  );
}

function Plaque({ song, onClose, isMe, storyHref }: { song: MonumentSong; onClose: () => void; isMe: boolean; storyHref: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const meta = [song.album, song.year].filter(Boolean).join(" · ");
  return (
    <div className="mon-plaque-wrap" onClick={onClose} role="dialog" aria-modal>
      <div className="mon-plaque" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-5">
          {song.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={song.imageUrl} alt="" className="h-28 w-28 shrink-0 rounded-sm shadow-lg" />
          )}
          <div className="min-w-0">
            <div className="mon-roman text-sm tracking-[0.2em] text-[#8a7a5c]">No. {roman(song.rank)}</div>
            <h2 className="mt-1 font-[family-name:var(--font-garamond)] text-3xl font-semibold leading-tight text-[#2f281e]">{song.name}</h2>
            <div className="mt-1 text-[#5b5143]">{song.artists}</div>
            {meta && <div className="text-sm text-[#8a7f6d]">{meta}</div>}
          </div>
        </div>
        {(song.love || song.moment || song.found || song.memory) && (
          <div className="mt-5 space-y-2 border-t border-[#d9cfbd] pt-4 text-[#3d3427]">
            {song.love && <p className="font-[family-name:var(--font-garamond)] text-xl italic leading-snug">“{song.love}”</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#6e624f]">
              {song.found && <span>{song.found}</span>}
              {song.moment && <span>♪ {song.moment}</span>}
            </div>
            {song.memory && <p className="text-sm italic text-[#6e624f]">{song.memory}</p>}
          </div>
        )}
        <iframe
          title="Spotify player"
          src={`https://open.spotify.com/embed/track/${song.id}?utm_source=generator&theme=0`}
          width="100%"
          height="80"
          className="mt-5 rounded-xl"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
        <div className="mt-4 flex justify-between text-sm">
          {isMe ? (
            <Link href={`${storyHref}&track=${song.id}`} className="text-[#8a6a2a] underline-offset-4 hover:underline">
              {song.love ? "Edit why it's here" : "Say why it's here"}
            </Link>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className="text-[#6e624f]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
