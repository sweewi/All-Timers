"use client";

import { useEffect, useState } from "react";

export type LiveItem = {
  handle: string;
  name: string;
  color: string;
  track: { id: string; name: string; artists: string; imageUrl: string | null };
};

/**
 * The crew's now-playing, kept fresh while the tab is visible (about once a minute),
 * paused while it's hidden, and backing off when the server says to.
 */
export function useLive(initial: LiveItem[], enabled = true) {
  const [live, setLive] = useState(initial);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let delay = 60_000;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const r = await fetch("/api/live", { signal: ctrl.signal, cache: "no-store" });
        if (r.status === 429 || r.status >= 500) delay = Math.min(delay * 2, 10 * 60_000);
        else if (r.ok) {
          delay = 60_000;
          const body = (await r.json()) as { live?: LiveItem[] };
          if (Array.isArray(body.live)) setLive(body.live);
        } else if (r.status === 401) return;
      } catch {
        delay = Math.min(delay * 2, 10 * 60_000);
      }
      timer = setTimeout(tick, delay);
    };
    const onVis = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") tick();
    };
    timer = setTimeout(tick, 1500);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
  return live;
}

export function artistsOf(json: string) {
  try {
    const a = JSON.parse(json);
    return Array.isArray(a) ? a.join(", ") : "";
  } catch {
    return "";
  }
}
