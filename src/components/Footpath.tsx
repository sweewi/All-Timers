"use client";

import { usePathname } from "next/navigation";
import { Portal } from "./Portal";

/**
 * The path out of every room: a row of doors on floating islands to the other rooms.
 * The plaza and the columns have their own ways out, so it hides there (via CSS).
 */
export function Footpath({ handle, cover }: { handle: string; cover?: string | null }) {
  const path = usePathname();
  const doors = [
    { href: "/", label: "The plaza", sub: "everyone's columns", tone: "dawn" as const, word: "✦" },
    { href: `/u/${handle}`, label: "Your column", sub: "climb it", tone: "night" as const, cover },
    { href: "/compare", label: "Compare", sub: "you vs anyone", tone: "dawn" as const, word: "VS" },
    { href: "/me/stories", label: "The why room", sub: "tell the stories", tone: "sea" as const, word: "“ ”" },
    { href: "/me/import", label: "Add songs", sub: "from Spotify", tone: "night" as const, word: "+" },
  ].filter((d) => d.href !== path);
  return (
    <section className="footpath" aria-label="Other rooms">
      <p className="footpath-k">Elsewhere in the place</p>
      <div className="doors footpath-doors">
        {doors.map((d) => (
          <Portal
            key={d.href}
            href={d.href}
            label={d.label}
            sub={d.sub}
            tone={d.tone}
            width={170}
            cover={d.cover}
            inside={d.word ? <span className="portal-word">{d.word}</span> : undefined}
          />
        ))}
      </div>
    </section>
  );
}
