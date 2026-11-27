"use client";

import { useTransition } from "react";
import { switchGroup } from "@/app/actions";

/** The group's name on the plaza; with more than one group, it's also the switcher. */
export function GroupSticker({ name, groups }: { name: string; groups: { id: string; name: string; current: boolean }[] }) {
  const [pending, start] = useTransition();
  if (groups.length < 2) return <p className="sticker sticker-blue -rotate-2">{name}</p>;
  return (
    <details className="group-sticker">
      <summary className="sticker sticker-blue -rotate-2">
        {name} <span aria-hidden>▾</span>
      </summary>
      <div className="group-menu">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            disabled={g.current || pending}
            onClick={() => start(() => switchGroup(g.id))}
            className={g.current ? "is-current" : ""}
          >
            {g.name}
            {g.current && " ✓"}
          </button>
        ))}
      </div>
    </details>
  );
}
