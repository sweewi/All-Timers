import type { FoundVia } from "@/db/schema";

/** How a song found someone. Shown as chips when writing and as a short tag when reading. */
export const FOUND_VIA_OPTIONS: { value: FoundVia; chip: string; tag: string }[] = [
  { value: "friend", chip: "A friend put me on", tag: "put on by" },
  { value: "someone", chip: "Someone else put me on", tag: "from" },
  { value: "grew_up", chip: "Grew up with it", tag: "grew up with it" },
  { value: "myself", chip: "Found it myself", tag: "found it myself" },
  { value: "live", chip: "Heard it live", tag: "heard it live" },
  { value: "screen", chip: "Movie, show or game", tag: "from the screen" },
  { value: "playlist", chip: "A playlist or the algorithm", tag: "the algorithm delivered" },
];

/** Prompts for "what do you love about it", picked per song so they vary down the list. */
export const LOVE_PROMPTS = [
  "The line that gets you every time…",
  "What it sounds like to you…",
  "Why it never gets old…",
  "What it does to a room…",
  "The feeling it puts you in…",
  "Why this one and not the rest of the album…",
  "What you'd tell someone hearing it for the first time…",
];

export function promptFor(trackId: string) {
  let h = 0;
  for (const c of trackId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LOVE_PROMPTS[h % LOVE_PROMPTS.length];
}
