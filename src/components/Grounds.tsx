import Link from "next/link";
import WORLD from "@/lib/world-manifest.json";

type Mini = { key: string; height: number; w: number; h: number; cover: [number, number, number, number]; ground: number; px: number };
const MINIS: Mini[] = Object.entries(WORLD as Record<string, Record<string, unknown>>)
  .filter(([k]) => k.startsWith("mini-"))
  .map(([k, v]) => ({ key: k, height: parseFloat(k.slice(5).replace("_", ".")), ...(v as Omit<Mini, "key" | "height">) }))
  .sort((a, b) => a.height - b.height);

export type GroundMember = {
  name: string;
  handle: string;
  color: string;
  count: number;
  cover: string | null;
  isMe: boolean;
  /** their list is set in stone */
  setInStone?: boolean;
};

/** Where each column stands: x across the plain (%), how near it is (1 = front row). */
const SPOTS = [
  { x: 50, d: 1 },
  { x: 24, d: 0.82 },
  { x: 76, d: 0.86 },
  { x: 8, d: 0.66 },
  { x: 92, d: 0.68 },
  { x: 37, d: 0.6 },
  { x: 64, d: 0.62 },
];

/**
 * The Grounds: everyone's column standing on the sand, the group's name carved huge
 * behind them. It is pinned to the world's ground, so as you scroll and the camera
 * lifts, the whole plain sinks away below you.
 */
export function Grounds({
  members,
  title,
  ghosts = 0,
  skipCenter = false,
}: {
  members: GroundMember[];
  title?: string;
  ghosts?: number;
  /** leave the front-centre spot empty (a column page stands its own base there) */
  skipCenter?: boolean;
}) {
  const maxCount = Math.max(1, ...members.map((m) => m.count));
  const spots = skipCenter ? SPOTS.slice(1) : SPOTS;
  const shown = members.slice(0, spots.length);
  const slots = [...shown.map((m) => ({ m })), ...Array.from({ length: Math.min(ghosts, spots.length - shown.length) }, () => ({ m: null }))];
  return (
    <div className="grounds" aria-label="Everyone's columns">
      {title && (
        <div className="grounds-title" aria-hidden style={{ ["--fs" as string]: `${Math.min(24, 118 / Math.max(4, title.length))}vw` }}>
          {title}
        </div>
      )}
      {slots
        .map((slot, i) => ({ ...slot, spot: spots[i] }))
        .sort((a, b) => a.spot.d - b.spot.d)
        .map(({ m, spot }, i) => {
          const tall = m ? m.count / maxCount : 0.3;
          const mini = MINIS.length ? MINIS[Math.min(MINIS.length - 1, Math.floor(tall * MINIS.length * 0.999))] : null;
          if (!mini) return null;
          // 1 m of stone = 6.4 vh in the front row; columns further back are smaller and higher up
          const k = 6.4 * spot.d;
          const H = (mini.h / mini.px) * k;
          const W = (mini.w / mini.px) * k;
          const groundY = 54 + 30 * Math.pow(spot.d, 2.2); // vh, where the lawn meets the sand
          const top = groundY - (mini.ground / mini.px) * k;
          const [cx, cy, cw, ch] = mini.cover;
          const style = {
            left: `calc(${spot.x}% - ${W / 2}vh)`,
            top: `${top}vh`,
            width: `${W}vh`,
            height: `${H}vh`,
            zIndex: Math.round(spot.d * 10),
          } as React.CSSProperties;
          const coverStyle = {
            left: `${(cx / mini.w) * 100}%`,
            top: `${(cy / mini.h) * 100}%`,
            width: `${(cw / mini.w) * 100}%`,
            height: `${(ch / mini.h) * 100}%`,
          };
          const inner = (
            <>
              <span className="mini-cover" style={coverStyle}>
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
                    <small>{m.count ? `${m.count} songs` : "no list yet"}</small>
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
          return m ? (
            <Link key={m.handle} href={`/u/${m.handle}`} className="mini" style={style} aria-label={`${m.name}'s column, ${m.count} songs`}>
              {inner}
            </Link>
          ) : (
            <a key={`ghost-${i}`} href="#invite" className="mini mini-ghost" style={style} aria-label="Invite a friend">
              {inner}
            </a>
          );
        })}
    </div>
  );
}
