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
  const plates = useRef<(HTMLButtonElement | null)[]>([]);
  // extra room a row needs when its nameplate is taller than the space under the ledge
  const [extra, setExtra] = useState<number[]>([]);
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
      el.style.setProperty("--rays", (0.45 + 0.4 * (1 - smooth(0.05, 0.75, p))).toFixed(3));
      el.style.setProperty("--birds", (smooth(0.08, 0.2, p) * (1 - smooth(0.6, 0.75, p))).toFixed(3));
      
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

  // Rows stretch (with a filler of plain shaft) so a long nameplate never covers the next song.
  useLayoutEffect(() => {
    const m = PX_PER_M * s;
    const coverTop = (i: number) => {
      // where the next piece's frame starts, measured from the top of row i+1
      const name = slices[i];
      const p = name ? PIECES[name] : null;
      return p?.cover ? (p.cover[1] - (p.ov ?? 0)) * s - 0.13 * m : 0.5 * m;
    };
    const measure = () => {
      const next: number[] = [];
      plates.current.forEach((el, i) => {
        if (!el) return;
        const row = rows.current[i];
        if (!row) return;
        const baseH = Number(row.dataset.base || 0);
        const bottom = el.offsetTop + el.offsetHeight;
        const limit = baseH + coverTop(i) - 0.05 * m;
        next[i] = Math.max(0, Math.ceil(bottom - limit));
      });
      setExtra((prev) => (prev.length === next.length && prev.every((v, k) => v === next[k]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    plates.current.forEach((el) => el && ro.observe(el));
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [s, slices, songs]);

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
  const m = PX_PER_M * s; // CSS pixels per meter
  // the overlap strip: each piece fades in over the bottom of the one above it
  const fadeTop = (ov: number): React.CSSProperties => {
    const g = `linear-gradient(to bottom, transparent 0, #000 ${ov * s}px)`;
    return { marginTop: -ov * s, WebkitMaskImage: g, maskImage: g };
  };

  return (
    <div ref={rootRef} className={`monument ${reduced ? "monument-still" : ""}`} style={{ ["--s" as string]: s }}>
      {/* the sky and garden behind everything */}
      <div className="mon-bg" aria-hidden>
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("garden")})` }} />
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("sky-mid")})`, opacity: "var(--sky-mid)" }} />
        <div className="mon-layer" style={{ backgroundImage: `url(${ASSET("sky-high")})`, opacity: "var(--sky-high)" }} />
        <div className="mon-warm" />
        <Birds />
      </div>

      {/* clouds drifting around the top of the column, at different depths */}
      <div className="mon-clouds" aria-hidden>
        <Cloud src="cloud-a" top={0} left="-22vw" width="78vw" depth={0.35} opacity={0.95} />
        <Cloud src="cloud-b" top={skyPad + crown.h * s * 0.45} left="44vw" width="74vw" depth={0.25} opacity={0.9} />
        <Cloud src="cloud-c" top={skyPad + crown.h * s * 1.25} left="-30vw" width="72vw" depth={0.18} opacity={0.85} />
        <Cloud src="cloud-a" top={skyPad + crown.h * s * 2.3} left="50vw" width="64vw" depth={0.12} opacity={0.6} />
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
            className="mon-row relative z-[2]"
            data-base={Math.floor(crown.h * s)}
            style={{ height: Math.floor(crown.h * s) + (extra[0] ?? 0) }}
          >
            {!!extra[0] && <Filler src={ASSET("crown")} w={crown.w * s} h={crown.h * s} top={Math.floor(crown.h * s)} extra={extra[0]} k={0.3 * m} left={-cropX} />}
            <div className="absolute top-0" style={{ left: -cropX, width: crown.w * s, height: crown.h * s }}>
              <Cover song={top} rect={crown.cover!} place={place} onOpen={setOpen} big />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ASSET("crown")} alt="" className="mon-piece" style={{ width: crown.w * s }} fetchPriority="high" />
              {crown.column && (
                <Nameplate
                  ref={(el) => {
                    plates.current[0] = el;
                  }}
                  song={top}
                  onOpen={setOpen}
                  m={m}
                  tier="gold"
                  style={{
                    left: (crown.w / 2) * s,
                    top: crown.column[1] * s - 1,
                    transform: "translateX(-50%)",
                    minWidth: 1.15 * m,
                    maxWidth: Math.min(1.75 * m, viewW - 24),
                  }}
                  big
                />
              )}
            </div>
          </section>
        )}

        {rest.map((song, i) => {
          const name = slices[i];
          const piece = PIECES[name];
          if (!piece) return null;
          const ov = piece.ov ?? 0;
          const right = name.includes("-R-");
          const tier = name.split("-")[1];
          // the plate hangs flush against the column under the capital and grows outward
          const inner = (piece.w / 2) * s + (right ? 1 : -1) * 0.44 * m;
          const plate: React.CSSProperties = {
            top: (piece.plaque ? piece.plaque[1] - ov : 0) * s - 1,
            minWidth: 1.06 * m,
            maxWidth: 1.46 * m,
            ...(right ? { left: inner } : { right: piece.w * s - inner }),
          };
          return (
            <section
              key={song.id}
              ref={(el) => {
                rows.current[i + 1] = el as HTMLDivElement;
              }}
              className="mon-row relative"
              data-base={Math.floor((piece.h - ov) * s)}
              style={{ height: Math.floor((piece.h - ov) * s) + (extra[i + 1] ?? 0) }}
            >
              {!!extra[i + 1] && (
                <Filler src={ASSET(name)} w={piece.w * s} h={piece.h * s} top={Math.floor((piece.h - ov) * s)} extra={extra[i + 1]} k={0.3 * m} left={-cropX} />
              )}
              <div className="absolute top-0" style={{ left: -cropX, width: piece.w * s, height: (piece.h - ov) * s }}>
                <Cover song={song} rect={[piece.cover![0], piece.cover![1] - ov, piece.cover![2], piece.cover![3]]} place={place} onOpen={setOpen} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ASSET(name)}
                  alt=""
                  className="mon-piece"
                  style={{ width: piece.w * s, ...fadeTop(ov) }}
                  loading={i < 3 ? "eager" : "lazy"}
                />
                <Nameplate
                  ref={(el) => {
                    plates.current[i + 1] = el;
                  }}
                  song={song}
                  onOpen={setOpen}
                  m={m}
                  tier={tier}
                  style={plate}
                />
              </div>
            </section>
          );
        })}

        {baseP && (
          <section className="relative" style={{ height: Math.floor((baseP.h - (baseP.ov ?? 0)) * s) }}>
            <div className="absolute top-0" style={{ left: -cropX, width: baseP.w * s, height: (baseP.h - (baseP.ov ?? 0)) * s }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ASSET(base)}
                alt=""
                className="mon-piece mon-base"
                style={{ width: baseP.w * s, marginTop: -(baseP.ov ?? 0) * s, ...baseMask(baseP.ov ?? 0, baseP.ground ?? baseP.h, s, m) }}
                loading="lazy"
              />
            </div>
          </section>
        )}
        <div className="relative z-10 pt-6 pb-16 text-center">
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

      {/* one finishing pass over everything, so renders and photographs read as one picture */}
      <div className="mon-finish" aria-hidden>
        <div className="mon-rays" />
        <div className="mon-grade" />
        <div className="mon-grain" />
      </div>

      {open && <Plaque song={open} onClose={() => setOpen(null)} isMe={isMe} storyHref={storyHref} />}
    </div>
  );
}

/**
 * The base sits in a small island of rendered grass that melts into the garden photo:
 * the column and plinth stay solid, the lawn fades out around them, the top fades in
 * over the slice above.
 */
function baseMask(ov: number, ground: number, s: number, m: number): React.CSSProperties {
  const g = ground * s;
  const top = `linear-gradient(to bottom, transparent 0, #000 ${ov * s}px, #000 ${g - 0.85 * m}px, transparent ${g - 0.6 * m}px)`;
  const column = `linear-gradient(to right, transparent calc(50% - ${0.735 * m}px), #000 calc(50% - ${0.715 * m}px), #000 calc(50% + ${0.715 * m}px), transparent calc(50% + ${0.735 * m}px))`;
  const island = `radial-gradient(${1.35 * m}px ${0.42 * m}px at 50% ${g - 0.06 * m}px, #000 30%, rgba(0,0,0,0.6) 60%, transparent 100%)`;
  const image = `${top}, ${column}, ${island}`;
  const size = `100% 100%, 100% ${g + 0.02 * m}px, 100% 100%`;
  return {
    WebkitMaskImage: image,
    maskImage: image,
    WebkitMaskSize: size,
    maskSize: size,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}

/** Plain shaft that stretches a row: the bottom strip of the same piece, drawn taller. */
function Filler({ src, w, h, top, extra, k, left }: { src: string; w: number; h: number; top: number; extra: number; k: number; left: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ top, left, width: w, height: extra + 2, overflow: "hidden", zIndex: 1 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="absolute bottom-0 left-0 max-w-none"
        style={{ width: w, height: h, transform: `scaleY(${(extra + 2) / k})`, transformOrigin: "50% 100%", clipPath: `inset(${h - k}px 0 0 0)` }}
      />
    </div>
  );
}

/** The marble nameplate under each ledge. It grows to fit: titles wrap, nothing is cut. */
function Nameplate({
  ref,
  song,
  onOpen,
  m,
  tier,
  style,
  big = false,
}: {
  song: MonumentSong;
  onOpen: (s: MonumentSong) => void;
  m: number;
  tier: string;
  style: React.CSSProperties;
  big?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const k = big ? 1.35 : 1;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onOpen(song)}
      className={`mon-tag mon-tag-${tier}`}
      style={{ ...style, ["--fs" as string]: `${Math.max(big ? 15 : 13, 0.066 * m * k)}px` }}
      aria-label={`#${song.rank} ${song.name} by ${song.artists}`}
    >
      <span className="mon-numeral" style={{ fontSize: Math.max(10, 0.044 * m * k) }}>
        {roman(song.rank)}
      </span>
      <span className="mon-title">{carvedTitle(song.name)}</span>
      <span className="mon-artist" style={{ fontSize: Math.max(9.5, 0.036 * m * k) }}>
        {song.artists}
      </span>
    </button>
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
