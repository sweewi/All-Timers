import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { fetchImageDataUri } from "./net";
import type { CardLayout, CardStyle, CardTheme } from "./profile";

/**
 * Share cards: a list drawn as an image, like a Wrapped card but permanent. Story size
 * for Instagram and group chats, square for posts, and a wide one that unfurls under a
 * link. Drawn with next/og (Satori: flexbox only, so every box is display:flex).
 */

export const CARD_FORMATS = { story: [1080, 1920], square: [1080, 1080], og: [1200, 630] } as const;
export type CardFormat = keyof typeof CARD_FORMATS;

export type CardSong = { name: string; artists: string; imageUrl: string | null };
export type CardData = {
  name: string;
  songs: CardSong[]; // in rank order, as many as the layout might use (up to 35)
  total: number;
  setAt: Date | null;
  rules: string | null;
  /** what they love about their #1 */
  why: string | null;
  /** host shown in the footer */
  site: string;
};

type Palette = { bg: string; ink: string; sub: string; accent: string; line: string; stars?: boolean; veins?: boolean };
const THEMES: Record<CardTheme, Palette> = {
  marble: {
    bg: "linear-gradient(165deg, #fdfaf3 0%, #efe8da 55%, #ddd4c1 100%)",
    ink: "#2a2318",
    sub: "#7a6c55",
    accent: "#a9822f",
    line: "rgba(120, 100, 60, 0.22)",
    veins: true,
  },
  cobalt: { bg: "linear-gradient(170deg, #2b4be0 0%, #1a2fa8 50%, #0b165e 100%)", ink: "#ffffff", sub: "#c8d2ff", accent: "#f3cf6e", line: "rgba(255,255,255,0.22)", stars: true },
  dusk: { bg: "linear-gradient(180deg, #ffc08f 0%, #e9718a 38%, #8e3a8c 70%, #2f1a63 100%)", ink: "#fffaf2", sub: "#ffe6d6", accent: "#ffe19a", line: "rgba(255,255,255,0.28)" },
  sand: { bg: "linear-gradient(170deg, #f6d3a8 0%, #e39a66 50%, #b9532f 100%)", ink: "#2b1508", sub: "#5e2f14", accent: "#fff5dc", line: "rgba(60, 25, 5, 0.22)" },
  olive: { bg: "linear-gradient(170deg, #4a5a35 0%, #2f3b22 55%, #1b2313 100%)", ink: "#f5efda", sub: "#cdc7a4", accent: "#dcc274", line: "rgba(245,239,218,0.2)" },
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** "Song (Remastered 2011) - Live" → "Song": cards have no room for version notes */
const cleanTitle = (s: string) => s.replace(/\s*[([].*?(remaster|version|edit|mix|live|mono|stereo|deluxe|feat\.).*?[)\]]/gi, "").replace(/\s+-\s+.*(remaster|version|edit|live).*$/i, "").trim() || s;

let fonts: Promise<{ name: string; data: Buffer; weight: 300 | 500 | 600 | 700; style: "normal" | "italic" }[]> | null = null;
function loadFonts() {
  fonts ??= (async () => {
    const dir = path.join(process.cwd(), "assets", "fonts");
    const f = (file: string) => readFile(path.join(dir, file));
    const [o3, o5, o3x, o5x, g5, g6, g5i, g5x, g6x, g5ix, c7] = await Promise.all([
      f("oswald-latin-300-normal.woff"),
      f("oswald-latin-500-normal.woff"),
      f("oswald-latin-ext-300-normal.woff"),
      f("oswald-latin-ext-500-normal.woff"),
      f("cormorant-garamond-latin-500-normal.woff"),
      f("cormorant-garamond-latin-600-normal.woff"),
      f("cormorant-garamond-latin-500-italic.woff"),
      f("cormorant-garamond-latin-ext-500-normal.woff"),
      f("cormorant-garamond-latin-ext-600-normal.woff"),
      f("cormorant-garamond-latin-ext-500-italic.woff"),
      f("cinzel-latin-700-normal.woff"),
    ]);
    return [
      { name: "Tall", data: o3, weight: 300 as const, style: "normal" as const },
      { name: "Tall", data: o5, weight: 500 as const, style: "normal" as const },
      { name: "TallX", data: o3x, weight: 300 as const, style: "normal" as const },
      { name: "TallX", data: o5x, weight: 500 as const, style: "normal" as const },
      { name: "Serif", data: g5, weight: 500 as const, style: "normal" as const },
      { name: "Serif", data: g6, weight: 600 as const, style: "normal" as const },
      { name: "Serif", data: g5i, weight: 500 as const, style: "italic" as const },
      { name: "SerifX", data: g5x, weight: 500 as const, style: "normal" as const },
      { name: "SerifX", data: g6x, weight: 600 as const, style: "normal" as const },
      { name: "SerifX", data: g5ix, weight: 500 as const, style: "italic" as const },
      { name: "Roman", data: c7, weight: 700 as const, style: "normal" as const },
    ];
  })();
  return fonts;
}
const TALL = "Tall, TallX";
const SERIF = "Serif, SerifX";
const ROMAN_FACE = "Roman, Serif";

/** Spotify serves each cover at 640, 300 and 64 px; ask for the size the card needs. */
function sized(url: string | null, px: 300 | 640) {
  if (!url) return null;
  return px === 300 ? url.replace("ab67616d0000b273", "ab67616d00001e02") : url;
}

async function covers(songs: CardSong[], n: number, px: 300 | 640, firstPx: 300 | 640 = px) {
  return Promise.all(songs.slice(0, n).map((s, i) => fetchImageDataUri(sized(s.imageUrl, i === 0 ? firstPx : px))));
}

export async function renderCard(data: CardData, style: CardStyle, format: CardFormat, headers: Record<string, string> = {}) {
  const [W, H] = CARD_FORMATS[format];
  const t = THEMES[style.theme];
  const layout: CardLayout = format === "og" ? "top5" : style.layout;
  const need = layout === "wall" ? 35 : layout === "top10" ? 10 : layout === "number1" ? 1 : 5;
  const art = await covers(data.songs, need, layout === "wall" || format === "og" ? 300 : 300, layout === "wall" ? 300 : 640);
  const el =
    format === "og" ? (
      <OgCard d={data} t={t} art={art} />
    ) : (
      <Frame t={t} W={W} H={H}>
        {layout === "top5" && <TopList d={data} t={t} art={art} style={style} format={format} n={5} />}
        {layout === "top10" && <TopList d={data} t={t} art={art} style={style} format={format} n={10} />}
        {layout === "number1" && <NumberOne d={data} t={t} art={art} style={style} format={format} />}
        {layout === "wall" && <Wall d={data} t={t} art={art} style={style} format={format} />}
      </Frame>
    );
  return new ImageResponse(el, { width: W, height: H, fonts: await loadFonts(), headers });
}

// ---------------------------------------------------------------------------- pieces

function Frame({ t, W, H, children }: { t: Palette; W: number; H: number; children: React.ReactNode }) {
  return (
    <div style={{ width: W, height: H, display: "flex", position: "relative", backgroundImage: t.bg, color: t.ink, fontFamily: SERIF }}>
      {t.veins && <Veins />}
      {t.stars && <Stars W={W} H={H} />}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", padding: W > 1000 ? "70px 76px" : "48px" }}>{children}</div>
    </div>
  );
}

function Veins() {
  const v = (deg: number, at: number, a: number) =>
    `linear-gradient(${deg}deg, rgba(0,0,0,0) ${at}%, rgba(130,115,90,${a}) ${at + 0.25}%, rgba(0,0,0,0) ${at + 0.9}%)`;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        backgroundImage: [v(118, 22, 0.16), v(124, 47, 0.1), v(110, 68, 0.13), v(130, 83, 0.08), "radial-gradient(70% 45% at 25% 8%, rgba(255,255,255,0.9), rgba(255,255,255,0))"].join(", "),
      }}
    />
  );
}

/** The same sky every time: star positions from a fixed sequence. */
const STARS = (() => {
  let seed = 7;
  const r = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  return Array.from({ length: 70 }, () => ({ x: r(), y: r() * 0.95, s: 2 + r() * 4, o: 0.35 + r() * 0.55 }));
})();

function Stars({ W, H }: { W: number; H: number }) {
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex" }}>
      {STARS.map((st, i) => (
        <div key={i} style={{ position: "absolute", left: st.x * W, top: st.y * H, width: st.s, height: st.s, borderRadius: st.s, background: "#fff", opacity: st.o }} />
      ))}
    </div>
  );
}

function Brand({ t, d, size = 26 }: { t: Palette; d: CardData; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: size, letterSpacing: size * 0.22, color: t.ink }}>
        ALL·TIMERS
      </div>
      {d.setAt && <Seal year={d.setAt.getFullYear()} size={size * 4.4} />}
    </div>
  );
}

function Seal({ year, size }: { year: number; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        backgroundImage: "radial-gradient(circle at 35% 30%, #fff0bd, #dcb052 42%, #a77b2b 78%, #7d5a1c)",
        boxShadow: "0 6px 0 #5e4416, 0 18px 30px rgba(0,0,0,0.35)",
        transform: "rotate(-10deg)",
        color: "#4c3810",
      }}
    >
      <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: size * 0.11, letterSpacing: size * 0.01, lineHeight: 1 }}>SET IN</div>
      <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: size * 0.11, letterSpacing: size * 0.01, lineHeight: 1.1 }}>STONE</div>
      <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: size * 0.27, lineHeight: 1 }}>{year}</div>
    </div>
  );
}

function Headline({ d, t, style, big }: { d: CardData; t: Palette; style: CardStyle; big: number }) {
  if (style.headline)
    return (
      <div style={{ display: "flex", fontFamily: TALL, fontWeight: 500, fontSize: big * 0.62, lineHeight: 0.98, textTransform: "uppercase", letterSpacing: -1 }}>
        {trunc(style.headline, 48)}
      </div>
    );
  const name = trunc(d.name, 16).toUpperCase();
  const fit = Math.min(big, (big * 7.2) / Math.max(4, name.length));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontFamily: TALL, fontWeight: 500, fontSize: fit, lineHeight: 0.92, letterSpacing: -2 }}>{name}&apos;S</div>
      <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: fit * 0.62, lineHeight: 1, color: t.accent, letterSpacing: 2 }}>
        ALL-TIMERS
      </div>
    </div>
  );
}

function Cover({ src, size, gilded, t }: { src: string | null; size: number; gilded?: boolean; t: Palette }) {
  const img = src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} style={{ width: size, height: size, objectFit: "cover" }} alt="" />
  ) : (
    <div style={{ display: "flex", width: size, height: size, backgroundImage: "linear-gradient(135deg, #d8ccb2, #a89a80)" }} />
  );
  if (!gilded) return <div style={{ display: "flex", boxShadow: `0 ${size * 0.05}px ${size * 0.12}px rgba(0,0,0,0.3)`, border: `1px solid ${t.line}` }}>{img}</div>;
  const g = Math.round(size * 0.03);
  return (
    <div
      style={{
        display: "flex",
        padding: g,
        backgroundImage: "linear-gradient(135deg, #f7e2a1, #c79a3e 35%, #fbeab6 55%, #a77b2b)",
        boxShadow: `0 ${size * 0.04}px ${size * 0.1}px rgba(0,0,0,0.35)`,
      }}
    >
      <div style={{ display: "flex", padding: g * 0.6, background: "#efe4c8" }}>{img}</div>
    </div>
  );
}

function Footer({ d, t, style, size }: { d: CardData; t: Palette; style: CardStyle; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: size * 0.4 }}>
      {style.showRules && d.rules && (
        <div style={{ display: "flex", fontFamily: SERIF, fontStyle: "italic", fontSize: size * 1.25, lineHeight: 1.25, color: t.ink }}>
          “{trunc(d.rules, 120)}”
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${t.line}`, paddingTop: size * 0.6 }}>
        <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: size, letterSpacing: 3, color: t.sub }}>
          {d.total} {d.total === 1 ? "SONG" : "SONGS"}
          {d.setAt ? " · FOR LIFE" : ""}
        </div>
        <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: size, letterSpacing: 2, color: t.sub }}>{d.site}</div>
      </div>
    </div>
  );
}

function SongLine({ s, rank, src, t, cover, title }: { s: CardSong; rank: number; src: string | null; t: Palette; cover: number; title: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: cover * 0.22 }}>
      <div style={{ display: "flex", width: title * 1.5, justifyContent: "flex-end", fontFamily: TALL, fontWeight: 300, fontSize: title * 1.25, color: t.accent }}>
        {rank}
      </div>
      <Cover src={src} size={cover} t={t} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: title, lineHeight: 1.08 }}>{trunc(cleanTitle(s.name), 34)}</div>
        <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 500, fontSize: title * 0.7, color: t.sub, marginTop: 4 }}>{trunc(s.artists, 40)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- layouts

type L = { d: CardData; t: Palette; art: (string | null)[]; style: CardStyle; format: CardFormat };

/** #1 in a gilded frame, then the next four (or nine). */
function TopList({ d, t, art, style, format, n }: L & { n: 5 | 10 }) {
  const story = format === "story";
  const top = d.songs[0];
  const rest = d.songs.slice(1, n);
  if (!top) return <Empty d={d} t={t} style={style} />;
  if (!story) {
    // square: #1 left, the rest stacked on the right
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <Brand t={t} d={d} size={22} />
        <div style={{ display: "flex", marginTop: 22 }}>
          <Headline d={d} t={t} style={style} big={110} />
        </div>
        <div style={{ display: "flex", gap: 36, marginTop: 30 }}>
          <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
            <Cover src={art[0]} size={372} gilded t={t} />
            <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: 20, color: t.accent, marginTop: 18, letterSpacing: 3 }}>NO. I</div>
            <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: 38, lineHeight: 1.05 }}>{trunc(cleanTitle(top.name), 30)}</div>
            <div style={{ display: "flex", fontFamily: SERIF, fontSize: 26, color: t.sub }}>{trunc(top.artists, 34)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: n === 10 ? 10 : 22, justifyContent: "center" }}>
            {rest.map((s, i) => (
              <SongLine key={i} s={s} rank={i + 2} src={art[i + 1]} t={t} cover={n === 10 ? 52 : 86} title={n === 10 ? 22 : 28} />
            ))}
          </div>
        </div>
        <Footer d={n === 10 ? { ...d, rules: null } : d} t={t} style={style} size={22} />
      </div>
    );
  }
  const heroSize = n === 10 ? 400 : 520;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Brand t={t} d={d} />
      <div style={{ display: "flex", marginTop: 34 }}>
        <Headline d={d} t={t} style={style} big={170} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 44 }}>
        <Cover src={art[0]} size={heroSize} gilded t={t} />
        <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: 28, color: t.accent, marginTop: 30, letterSpacing: 5 }}>NO. I</div>
        <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: 60, lineHeight: 1.05, textAlign: "center", marginTop: 6 }}>
          {trunc(cleanTitle(top.name), 30)}
        </div>
        <div style={{ display: "flex", fontFamily: SERIF, fontSize: 36, color: t.sub, marginTop: 4 }}>{trunc(top.artists, 40)}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: n === 10 ? 14 : 24, marginTop: n === 10 ? 34 : 44 }}>
        {rest.map((s, i) => (
          <SongLine key={i} s={s} rank={i + 2} src={art[i + 1]} t={t} cover={n === 10 ? 64 : 96} title={n === 10 ? 28 : 36} />
        ))}
      </div>
      <Footer d={n === 10 ? { ...d, rules: null } : d} t={t} style={style} size={28} />
    </div>
  );
}

/** One song, and why. */
function NumberOne({ d, t, art, style, format }: L) {
  const story = format === "story";
  const top = d.songs[0];
  if (!top) return <Empty d={d} t={t} style={style} />;
  const cover = story ? 800 : 470;
  const why = d.why ? trunc(d.why, story ? 160 : 110) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Brand t={t} d={d} size={story ? 26 : 22} />
      <div style={{ display: "flex", marginTop: story ? 30 : 18 }}>
        <Headline d={d} t={t} style={style} big={story ? 130 : 90} />
      </div>
      <div style={{ display: "flex", flexDirection: story ? "column" : "row", alignItems: story ? "center" : "flex-start", gap: story ? 0 : 36, marginTop: story ? 50 : 30 }}>
        <Cover src={art[0]} size={cover} gilded t={t} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: story ? "center" : "flex-start", ...(story ? {} : { flex: 1 }) }}>
          <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: story ? 30 : 22, color: t.accent, marginTop: story ? 40 : 6, letterSpacing: 5 }}>
            NUMBER ONE
          </div>
          <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: story ? 76 : 50, lineHeight: 1.02, textAlign: story ? "center" : "left", marginTop: 8 }}>
            {trunc(cleanTitle(top.name), 28)}
          </div>
          <div style={{ display: "flex", fontFamily: SERIF, fontSize: story ? 40 : 30, color: t.sub, marginTop: 6 }}>{trunc(top.artists, 36)}</div>
          {why && (
            <div style={{ display: "flex", fontFamily: SERIF, fontStyle: "italic", fontSize: story ? 46 : 32, lineHeight: 1.25, marginTop: story ? 40 : 26, textAlign: story ? "center" : "left" }}>
              “{why}”
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
        {d.total > 1 && (
          <div style={{ display: "flex", justifyContent: story ? "center" : "flex-start", fontFamily: TALL, fontWeight: 300, fontSize: story ? 34 : 24, color: t.sub, marginBottom: 18, letterSpacing: 3 }}>
            + {d.total - 1} MORE ON THE LIST
          </div>
        )}
        <Footer d={{ ...d, rules: null }} t={t} style={style} size={story ? 28 : 22} />
      </div>
    </div>
  );
}

/** Every cover, a mosaic of the whole list. */
function Wall({ d, t, art, style, format }: L) {
  const story = format === "story";
  const count = Math.min(d.songs.length, story ? 35 : 20);
  // fewer songs, bigger tiles: the wall always fills its width
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : count <= 16 ? 4 : 5;
  const inner = story ? 1080 - 152 : 1080 - 96;
  const gap = story ? 12 : 10;
  const tile = Math.floor((inner - gap * (cols - 1)) / cols) - 2; // 1px border each side
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Brand t={t} d={d} size={story ? 26 : 22} />
      <div style={{ display: "flex", marginTop: story ? 30 : 16 }}>
        <Headline d={d} t={t} style={style} big={story ? 150 : 96} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap, marginTop: story ? 40 : 24, width: inner }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={{ display: "flex", position: "relative" }}>
            <Cover src={art[i]} size={tile} t={t} />
            <div
              style={{
                position: "absolute",
                left: 8,
                top: 6,
                display: "flex",
                fontFamily: TALL,
                fontWeight: 500,
                fontSize: Math.max(22, tile * 0.13),
                color: "#fff",
                textShadow: "0 1px 6px rgba(0,0,0,0.8)",
              }}
            >
              {i + 1}
            </div>
          </div>
        ))}
      </div>
      {d.total > count && (
        <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: story ? 30 : 22, color: t.sub, marginTop: 18, letterSpacing: 3 }}>
          AND {d.total - count} MORE
        </div>
      )}
      <Footer d={d} t={t} style={style} size={story ? 28 : 22} />
    </div>
  );
}

function Empty({ d, t, style }: { d: CardData; t: Palette; style: CardStyle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Brand t={t} d={d} />
      <div style={{ display: "flex", marginTop: 40 }}>
        <Headline d={d} t={t} style={style} big={150} />
      </div>
      <div style={{ display: "flex", fontFamily: SERIF, fontStyle: "italic", fontSize: 48, marginTop: 60, color: t.sub }}>The list is still being written.</div>
    </div>
  );
}

/** The wide card that unfurls under a shared link. */
function OgCard({ d, t, art }: { d: CardData; t: Palette; art: (string | null)[] }) {
  const top = d.songs[0];
  return (
    <Frame t={t} W={1200} H={630}>
      <div style={{ display: "flex", flex: 1, gap: 46, marginTop: -20 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Cover src={art[0]} size={420} gilded t={t} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <Brand t={t} d={d} size={20} />
          <div style={{ display: "flex", fontFamily: TALL, fontWeight: 500, fontSize: 84, lineHeight: 0.95, marginTop: 14, letterSpacing: -1 }}>
            {trunc(d.name, 14).toUpperCase()}&apos;S
          </div>
          <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: 52, lineHeight: 1, color: t.accent, letterSpacing: 2 }}>ALL-TIMERS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
            {d.songs.slice(0, 3).map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: 22, color: t.accent, width: 40 }}>{ROMAN[i + 1]}</div>
                <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: 32 }}>{trunc(cleanTitle(s.name), 26)}</div>
                <div style={{ display: "flex", fontFamily: SERIF, fontSize: 24, color: t.sub }}>{trunc(s.artists, 18)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: "auto", fontFamily: TALL, fontWeight: 300, fontSize: 24, color: t.sub, letterSpacing: 3 }}>
            {d.total} SONGS{top && d.setAt ? " · SET IN STONE" : ""}
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------- invites

export type GroupCardData = { group: string; members: { name: string; color: string; cover: string | null; count: number }[]; site: string };

/** What an invite link looks like in a group chat: the group's name and everyone's #1. */
export async function renderGroupCard(g: GroupCardData, headers: Record<string, string> = {}) {
  const t = THEMES.cobalt;
  const shown = g.members.filter((m) => m.count > 0).slice(0, 5);
  const art = await Promise.all(shown.map((m) => fetchImageDataUri(sized(m.cover, 300))));
  const el = (
    <Frame t={t} W={1200} H={630}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", fontFamily: ROMAN_FACE, fontWeight: 700, fontSize: 22, letterSpacing: 5 }}>ALL·TIMERS</div>
        <div style={{ display: "flex", fontFamily: TALL, fontWeight: 300, fontSize: 40, color: t.accent, marginTop: 18, letterSpacing: 2 }}>YOU&apos;RE INVITED TO</div>
        <div style={{ display: "flex", fontFamily: TALL, fontWeight: 500, fontSize: 96, lineHeight: 0.95, letterSpacing: -1 }}>{trunc(g.group, 22).toUpperCase()}</div>
        <div style={{ display: "flex", gap: 22, marginTop: "auto" }}>
          {shown.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Cover src={art[i]} size={170} gilded={i === 0} t={t} />
              <div style={{ display: "flex", fontFamily: SERIF, fontWeight: 600, fontSize: 26 }}>{trunc(m.name, 12)}&apos;s #1</div>
            </div>
          ))}
          {shown.length === 0 && (
            <div style={{ display: "flex", fontFamily: SERIF, fontStyle: "italic", fontSize: 40, color: t.sub }}>Which songs are your All-Timers?</div>
          )}
        </div>
      </div>
    </Frame>
  );
  return new ImageResponse(el, { width: 1200, height: 630, fonts: await loadFonts(), headers });
}
