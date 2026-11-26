"use client";

import { useState, useTransition } from "react";
import { toggleReaction } from "@/app/actions";

const KINDS = [
  { k: "laurel", e: "🌿", label: "Laurel: deserves its place" },
  { k: "fire", e: "🔥", label: "Fire" },
  { k: "cry", e: "😭", label: "Makes me cry" },
  { k: "same", e: "🤝", label: "Same" },
] as const;

export type Counts = Partial<Record<(typeof KINDS)[number]["k"], { n: number; mine: boolean; who: string[] }>>;

/** A row of little sticker reactions. Optimistic: the tap lands instantly. */
export function Reactions({ target, initial, canReact = true, size = "md" }: { target: string; initial?: Counts; canReact?: boolean; size?: "sm" | "md" }) {
  const [counts, setCounts] = useState<Counts>(initial ?? {});
  const [, start] = useTransition();
  return (
    <span className={`reacts reacts-${size}`} onClick={(e) => e.stopPropagation()}>
      {KINDS.map(({ k, e, label }) => {
        const c = counts[k];
        const n = c?.n ?? 0;
        const tip = c?.who.length ? `${label} · ${c.who.join(", ")}` : label;
        return (
          <button
            key={k}
            type="button"
            title={tip}
            aria-label={tip}
            aria-pressed={!!c?.mine}
            disabled={!canReact}
            className={`react ${c?.mine ? "react-on" : ""} ${n ? "" : "react-zero"}`}
            onClick={() => {
              const on = !c?.mine;
              setCounts((prev) => {
                const p = prev[k] ?? { n: 0, mine: false, who: [] };
                return { ...prev, [k]: { n: Math.max(0, p.n + (on ? 1 : -1)), mine: on, who: on ? [...p.who, "You"] : p.who.filter((w) => w !== "You") } };
              });
              start(async () => {
                await toggleReaction(target, k);
              });
            }}
          >
            <span className="react-e">{e}</span>
            {n > 0 && <span className="react-n">{n}</span>}
          </button>
        );
      })}
    </span>
  );
}
