"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Altitude } from "@/components/World";
import { Grounds, type GroundMember } from "@/components/Grounds";
import { StealButton } from "@/components/StealButton";
import { Reactions, type Counts } from "@/components/Reactions";
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
  /** friends who also have this song, and where they rank it */
  echoes: Friend[];
  /** the friend who put this person on to it */
  from: Omit<Friend, "rank"> | null;
  /** the viewer doesn't have it yet: offer "Steal it" */
  steal: boolean;
  /** friends' reactions to this song on this column */
  reactions: Counts;
  /** lifetime plays from stats.fm, if this person shares them. `under`: past the depth we fetched */
  plays?: { streams: number | null; rank: number | null; under: number | null } | null;
};

export type Receipts = {
  streams: number | null;
  hours: number | null;
  mostPlayed: { name: string; rank: number; streams: number } | null;
  topIsMost: boolean;
};

function playsText(p: MonumentSong["plays"]) {
  if (!p) return null;
  if (p.streams != null) return `${p.streams.toLocaleString()} ${p.streams === 1 ? "play" : "plays"}`;
  // free stats.fm accounts get a rank without a count
  if (p.rank != null) return `#${p.rank} most played`;
  if (p.under) return `under ${p.under} plays`;
  return null;
}

export type Friend = { name: string; handle: string; color: string; rank: number };
export type Neighbor = GroundMember;

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
  neighbors,
  receipts = null,
}: {
  person: { id: string; name: string; handle: string; color: string };
  songs: MonumentSong[];
  receipts?: Receipts | null;
  isMe: boolean;
  storyHref: string;
  toolbar?: React.ReactNode;
  neighbors: Neighbor[];
}) {
  const [vw, setVw] = useState(1200);
  const [open, setOpen] = useState<MonumentSong | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const plates = useRef<(HTMLDivElement | null)[]>([]);
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
  // the name stands just behind the frame: the frame covers only its feet
  const giantPx = Math.min(viewW * (mobile ? 0.3 : Math.max(0.14, 0.92 / Math.max(3, person.name.length))), 300);
  const frameTop = skyPad + ((crown.cover?.[1] ?? 0) - 0.13 * PX_PER_M) * s;
  const giantStyle: React.CSSProperties = { top: frameTop - giantPx * 0.66, fontSize: giantPx };
  // the overlap strip: each piece fades in over the bottom of the one above it
  const fadeTop = (ov: number): React.CSSProperties => {
    const g = `linear-gradient(to bottom, transparent 0, #000 ${ov * s}px)`;
    return { marginTop: -ov * s, WebkitMaskImage: g, maskImage: g };
  };

  return (
    <div ref={rootRef} className={`monument ${reduced ? "monument-still" : ""}`} style={{ ["--s" as string]: s }}>
      {/* the camera rides the column: high blue sky at #1, the sand at the last song */}
      <Altitude stops={[{ y: 0, alt: 0.9 }, { y: "end", back: 1, alt: 0.31 }, { y: "end", alt: 0 }]} />

      <div className="relative mx-auto" style={{ width: viewW, overflowX: "clip" }}>

        <header className="relative z-[3] pt-10 text-center" style={{ height: skyPad }}>
          <p className="sticker sticker-blue -rotate-2">
            {isMe ? "Your all-timers" : `${person.name}'s all-timers`} · {songs.length} {songs.length === 1 ? "song" : "songs"}
          </p>
          {toolbar && <div className="mt-4 flex flex-wrap justify-center gap-2">{toolbar}</div>}
          {receipts && (receipts.streams != null || receipts.mostPlayed || receipts.topIsMost) && (
            <div className="mon-receipts">
              {receipts.streams != null && (
                <span className="sticker sticker-paper rotate-1">
                  {receipts.streams.toLocaleString()} plays all time{receipts.hours != null && ` · ${receipts.hours.toLocaleString()} hours`}
                </span>
              )}
              {receipts.topIsMost && <span className="sticker sticker-paper -rotate-1">#1 is also the most played. Consistent.</span>}
              {receipts.mostPlayed && (
                <span className="sticker sticker-paper -rotate-1">
                  Most played here: {receipts.mostPlayed.name} ({receipts.mostPlayed.streams.toLocaleString()}), ranked #{receipts.mostPlayed.rank}
                </span>
              )}
              <a href="https://stats.fm" target="_blank" rel="noopener noreferrer" className="mon-credit">
                plays via stats.fm
              </a>
            </div>
          )}
        </header>
        {/* the name, huge, behind the top of the column */}
        <h1 className="mon-giant" style={giantStyle}>
          {person.name}
        </h1>

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
                  ownerId={person.id}
                  align="center"
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
                  ownerId={person.id}
                  align={right ? "start" : "end"}
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
          <section className="relative z-[2]" style={{ height: Math.floor((baseP.h - (baseP.ov ?? 0)) * s) }}>
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
        {/* the bottom of the column is the plain: friends' columns stand around it, walk to one */}
        <div aria-hidden style={{ height: `max(0px, calc(16vh - ${Math.round(((baseP?.h ?? 0) - (baseP?.ground ?? 0)) * s)}px))` }} />
      </div>
      <Grounds members={neighbors} skipCenter />
      <nav className="mon-exits" aria-label="Where next">
        <span className="mon-exits-k">{neighbors.length ? "Walk to a friend's column, or" : "That's the whole column"}</span>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="sticker sticker-blue">
          ↑ Fly back up to #1
        </button>
        <Link href="/" className="sticker sticker-paper">The plaza</Link>
        {isMe && (
          <Link href={storyHref} className="sticker sticker-steal">
            Say why they&apos;re here
          </Link>
        )}
      </nav>

      {open && <Plaque song={open} onClose={() => setOpen(null)} isMe={isMe} storyHref={storyHref} ownerId={person.id} ownerName={person.name} />}
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

/** The marble nameplate under each ledge, with the social stickers that hang off it. It grows to fit. */
function Nameplate({
  ref,
  song,
  onOpen,
  m,
  tier,
  style,
  big = false,
  align,
  ownerId,
}: {
  song: MonumentSong;
  onOpen: (s: MonumentSong) => void;
  m: number;
  tier: string;
  style: React.CSSProperties;
  big?: boolean;
  align: "start" | "end" | "center";
  ownerId: string;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const k = big ? 1.35 : 1;
  const tags = song.echoes.slice(0, 3);
  const EMO: Record<string, string> = { laurel: "🌿", fire: "🔥", cry: "😭", same: "🤝" };
  const reacts = Object.entries(song.reactions ?? {}).filter(([, v]) => v && v.n > 0);
  return (
    <div ref={ref} className="mon-tagwrap" style={{ ...style, alignItems: align === "start" ? "flex-start" : align === "end" ? "flex-end" : "center" }}>
      <button
        type="button"
        onClick={() => onOpen(song)}
        className={`mon-tag mon-tag-${tier}`}
        style={{ ["--fs" as string]: `${Math.max(big ? 15 : 13, 0.066 * m * k)}px`, width: "100%" }}
        aria-label={`#${song.rank} ${song.name} by ${song.artists}`}
      >
        <span className="mon-numeral" style={{ fontSize: Math.max(10, 0.044 * m * k) }}>
          {roman(song.rank)}
        </span>
        <span className="mon-title">{carvedTitle(song.name)}</span>
        <span className="mon-artist" style={{ fontSize: Math.max(9.5, 0.036 * m * k) }}>
          {song.artists}
        </span>
        {playsText(song.plays) && (
          <span className="mon-plays" style={{ fontSize: Math.max(9, 0.03 * m * k) }}>
            {playsText(song.plays)}
          </span>
        )}
      </button>
      {(tags.length > 0 || song.from || song.steal || reacts.length > 0) && (
        <div className={`mon-stickers ${align === "end" ? "justify-end" : align === "center" ? "justify-center" : ""}`}>
          {song.from && (
            <Link href={`/u/${song.from.handle}`} className="sticker sticker-paper" style={{ ["--c" as string]: song.from.color }}>
              <i style={{ background: song.from.color }} /> put on by {song.from.name}
            </Link>
          )}
          {tags.map((t) => (
            <Link key={t.handle} href={`/u/${t.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: t.color }} title={`${t.name} has it at #${t.rank}`}>
              {t.name} #{t.rank}
            </Link>
          ))}
          {song.echoes.length > 3 && <span className="sticker sticker-paper">+{song.echoes.length - 3}</span>}
          {reacts.length > 0 && (
            <button type="button" onClick={() => onOpen(song)} className="sticker sticker-paper" title="Friends' reactions">
              {reacts.map(([k, v]) => `${EMO[k]}${v!.n > 1 ? v!.n : ""}`).join(" ")}
            </button>
          )}
          {song.steal && <StealButton trackId={song.id} fromUserId={ownerId} />}
        </div>
      )}
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

function Plaque({
  song,
  onClose,
  isMe,
  storyHref,
  ownerId,
  ownerName,
}: {
  song: MonumentSong;
  onClose: () => void;
  isMe: boolean;
  storyHref: string;
  ownerId: string;
  ownerName: string;
}) {
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
            {song.plays && playsText(song.plays) && (
              <div className="mt-2 text-sm text-[#6e624f]">
                <span className="font-semibold text-[#3d3427]">{playsText(song.plays)}</span>
                {song.plays.rank != null && song.plays.streams != null && <> · #{song.plays.rank} most played, ever</>}
                <a href="https://stats.fm" target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-[#a3977f] hover:underline">stats.fm</a>
              </div>
            )}
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
        {(song.echoes.length > 0 || song.steal) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#d9cfbd] pt-4 text-sm text-[#5b5143]">
            {song.echoes.length > 0 ? (
              <>
                <span>Also on</span>
                {song.echoes.map((t) => (
                  <Link key={t.handle} href={`/u/${t.handle}`} className="sticker sticker-friend" style={{ ["--c" as string]: t.color }}>
                    {t.name} #{t.rank}
                  </Link>
                ))}
              </>
            ) : (
              <span>Only {ownerName} has this one.</span>
            )}
            {song.steal && <span className="ml-auto"><StealButton trackId={song.id} fromUserId={ownerId} /></span>}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3 border-t border-[#d9cfbd] pt-4 text-sm text-[#5b5143]">
          <span>{isMe ? "Friends say" : "React"}</span>
          <Reactions target={`song:${ownerId}:${song.id}`} initial={song.reactions} canReact={!isMe} />
        </div>
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
