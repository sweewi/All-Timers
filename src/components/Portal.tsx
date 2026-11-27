import Link from "next/link";
import WORLD from "@/lib/world-manifest.json";

type Rect = [number, number, number, number];
type Door = { w: number; h: number; opening: Rect };
const DOORS = WORLD as unknown as Record<string, Door>;

/** Which way a door turns: left of a row faces right, right of a row faces left. */
export type Turn = "left" | "front" | "right";
const SPRITE: Record<Turn, string> = { left: "doorm24", front: "doorp0", right: "doorp24" };

/** Turn for the i-th of n doors standing in a curve around you. */
export function turnFor(i: number, n: number): Turn {
  if (n <= 1) return "front";
  const t = i / (n - 1);
  return t < 0.34 ? "left" : t > 0.66 ? "right" : "front";
}

/**
 * A marble arch on its own floating island that opens onto somewhere else: another
 * friend's column, Compare, the why room. Rendered at three angles so a row of them
 * curves around you; the opening is cut out with a rendered mask, so what shows through
 * it (the preview) sits exactly inside the stone.
 */
export function Portal({
  href,
  label,
  sub,
  width = 220,
  cover,
  color,
  inside,
  tone = "night",
  turn = "front",
  style,
}: {
  href: string;
  label: string;
  sub?: string;
  width?: number;
  cover?: string | null;
  color?: string;
  inside?: React.ReactNode;
  tone?: "night" | "dawn" | "sea";
  turn?: Turn;
  style?: React.CSSProperties;
}) {
  const key = SPRITE[turn];
  const door = DOORS[key];
  const s = width / door.w;
  const [x, y, w, h] = door.opening;
  return (
    <Link
      href={href}
      className={`portal portal-${turn} group`}
      style={{ width, height: door.h * s, ...style }}
      aria-label={`${label}${sub ? `, ${sub}` : ""}`}
    >
      <span className="portal-float">
        <span
          className={`portal-inside portal-${tone}`}
          style={{
            WebkitMaskImage: `url(/monument/${key}-mask.webp)`,
            maskImage: `url(/monument/${key}-mask.webp)`,
          }}
        >
          <span className="portal-view" style={{ left: x * s, top: y * s, width: w * s, height: h * s }}>
            <span className="portal-stars" />
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="portal-cover" />
            )}
            {inside}
          </span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/monument/${key}.webp`} alt="" className="portal-arch" />
      </span>
      <span className="portal-label">
        <b style={color ? { ["--c" as string]: color } : undefined}>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </Link>
  );
}

type DoorProps = Omit<React.ComponentProps<typeof Portal>, "turn" | "style">;

/** A row of doors standing in a curve around you: the middle ones further off. */
export function Doors({ doors, width = 210, className = "" }: { doors: DoorProps[]; width?: number; className?: string }) {
  const n = doors.length;
  return (
    <div className={`doors ${className}`}>
      {doors.map((d, i) => {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const far = 1 - Math.abs(t - 0.5) * 2; // 1 in the middle, 0 at the ends
        return (
          <Portal
            key={d.href}
            {...d}
            width={width}
            turn={turnFor(i, n)}
            style={{
              ["--depth" as string]: far.toFixed(2),
              ["--delay" as string]: `${-i * 1.3}s`,
            }}
          />
        );
      })}
    </div>
  );
}
