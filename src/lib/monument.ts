import manifest from "./monument-manifest.json";

/**
 * The monument view: each list is a marble column. #1 sits in a big gold frame on the
 * capital in the clouds; every other song rests on an Ionic scroll ledge down the
 * shaft. The column wears as you go down: pristine, clean, weathered, then worn with
 * ivy, ending at the base in a garden.
 *
 * Pieces are pre-rendered (Blender) and stacked; `manifest` holds each piece's pixel
 * size, where the cover opening sits and where each nameplate hangs.
 */

export type Rect = [number, number, number, number]; // x, y, w, h in source pixels
/** `ov` is the strip rendered above a piece that fades over the one above it; `plaque` is
 *  [x, y, width] of the capital's underside, where the song's nameplate hangs. */
export type Piece = {
  w: number; h: number; ov?: number; cover?: Rect; column?: Rect; plinth?: Rect;
  plaque?: [number, number, number]; ground?: number;
};
export const PIECES = manifest as unknown as Record<string, Piece>;

/** Meters-to-pixels used for the renders, and the column's horizontal extent. */
export const PX_PER_M = PIECES.crown.w / 3.9;
export const SLICE_W_M = 3.9;

export type Tier = "pristine" | "clean" | "weathered" | "worn";

/** Which rendered slice a song gets, from its rank and the list length. */
export function sliceFor(rank: number, total: number, side: "L" | "R") {
  const f = total <= 2 ? 0 : (rank - 2) / (total - 2);
  let tier: Tier;
  if (f < 0.25) tier = "pristine";
  else if (f < 0.5) tier = "clean";
  else if (f < 0.72) tier = "weathered";
  else tier = "worn";
  const kind = rank <= 5 ? "gold" : "stone";
  if (kind === "gold") tier = "pristine";
  // the slice just above the first worn one carries the ivy tips
  let vines = "";
  if (tier === "worn") vines = "-full";
  else if (tier === "weathered") {
    const next = total <= 2 ? 0 : (rank - 1) / (total - 2);
    if (next >= 0.72 && rank < total) vines = "-tips";
  }
  return `slice-${tier}-${side}-${kind}${vines}`;
}

export function roman(n: number) {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The base continues the ivy of a worn slice above it; otherwise its ivy ends low. */
export function baseFor(lastSlice: string | null) {
  return lastSlice && lastSlice.endsWith("-full") ? "base" : "base-tips";
}

/** Title for the nameplate: drops only reissue noise like "- 2011 Remaster"; everything else stays. */
export function carvedTitle(t: string) {
  return t
    .replace(/\s+-\s+(\d{4}\s+)?(digital(ly)?\s+)?remaster(ed)?(\s+\d{4})?(\s+version)?\s*$/i, "")
    .replace(/\s*[([](\d{4}\s+)?(digital(ly)?\s+)?remaster(ed)?(\s+\d{4})?(\s+version)?[)\]]\s*$/i, "")
    .trim() || t;
}
