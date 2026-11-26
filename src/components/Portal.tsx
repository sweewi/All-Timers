import Link from "next/link";
import WORLD from "@/lib/world-manifest.json";

type Rect = [number, number, number, number];
const ARCH = WORLD.arch as unknown as { w: number; h: number; opening: Rect };

/**
 * A freestanding marble arch on the sand that opens onto somewhere else: another
 * friend's column, Compare, the story room. What's inside the opening is the preview.
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
}: {
  href: string;
  label: string;
  sub?: string;
  width?: number;
  cover?: string | null;
  color?: string;
  inside?: React.ReactNode;
  tone?: "night" | "dawn" | "sea";
}) {
  const s = width / ARCH.w;
  const [x, y, w, h] = ARCH.opening;
  return (
    <Link href={href} className="portal group" style={{ width, height: ARCH.h * s }} aria-label={`${label}${sub ? `, ${sub}` : ""}`}>
      <span className={`portal-inside portal-${tone}`} style={{ left: x * s, top: y * s, width: w * s, height: h * s, borderRadius: `${(w * s) / 2}px ${(w * s) / 2}px 2px 2px` }}>
        <span className="portal-stars" />
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="portal-cover" />
        )}
        {inside}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/monument/arch.webp" alt="" className="portal-arch" />
      <span className="portal-label">
        <b style={color ? { ["--c" as string]: color } : undefined}>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </Link>
  );
}
