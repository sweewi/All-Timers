"use client";

import { useState, useTransition } from "react";
import { stealSong } from "@/app/actions";

/** "Steal your friends' good music": drops the song in your On Deck, credited to them. */
export function StealButton({ trackId, fromUserId, label = "Steal it" }: { trackId: string; fromUserId: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "had">("idle");
  const [pending, start] = useTransition();
  if (state !== "idle")
    return <span className="sticker sticker-done">{state === "done" ? "On Deck ✓" : "Already yours"}</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          const r = await stealSong(trackId, fromUserId);
          if (r.ok) setState(r.already ? "had" : "done");
        });
      }}
      className="sticker sticker-steal"
    >
      {pending ? "Stealing…" : label}
    </button>
  );
}
