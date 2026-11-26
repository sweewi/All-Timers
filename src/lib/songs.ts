/**
 * Song identity has three levels:
 *  - Spotify track ID: one release appearance (too fine: single vs album copy differ)
 *  - ISRC: one recording, i.e. one *version* (live, remaster, demo each get their own)
 *  - song key: normalized title + primary artist, i.e. the *song* across versions
 */

const VERSION_TAGS =
  /\s*[-–(\[]\s*(\d{4}\s+)?(remaster(ed)?|live|demo|mono|stereo|acoustic|radio edit|single version|album version|deluxe|edit|version|mix|remix|re-?recorded|taylor'?s version|from )[^)\]]*[)\]]?\s*$/i;

export function normalizeTitle(title: string) {
  let t = title.toLowerCase();
  // Strip trailing version descriptors repeatedly: "Song - 2011 Remaster (Live)".
  for (let i = 0; i < 3; i++) {
    const next = t.replace(VERSION_TAGS, "");
    if (next === t) break;
    t = next;
  }
  return t
    .replace(/\(feat\.?[^)]*\)|\[feat\.?[^\]]*\]|\sfeat\.?\s.*$/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Track.artists is stored as a JSON array (names can contain commas: "Tyler, The Creator"). */
export function artistList(artists: string): string[] {
  try {
    const parsed = JSON.parse(artists);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return artists ? [artists] : [];
  }
}

export const artistLine = (artists: string) => artistList(artists).join(", ");

export function songKey(title: string, artists: string[]) {
  return `${normalizeTitle(title)}|${(artists[0] ?? "").trim().toLowerCase()}`;
}
