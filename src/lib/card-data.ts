import "server-only";
import { getList } from "./lists";
import { getProfile } from "./profile";
import { artistLine } from "./songs";
import type { CardData } from "./card";
import type { User } from "@/db/schema";
import { CARD_FORMATS, type CardFormat } from "./card";
import { cardOf, zCard, type CardStyle } from "./profile";

/** Everything a share card shows about a person's list. Nothing from stats.fm. */
export async function cardDataFor(user: Pick<User, "id" | "name">, site: string): Promise<CardData> {
  const [list, profile] = await Promise.all([getList(user.id, "all_time"), getProfile(user.id)]);
  return {
    name: user.name,
    songs: list.slice(0, 35).map((e) => ({ name: e.track.name, artists: artistLine(e.track.artists), imageUrl: e.track.imageUrl })),
    total: list.length,
    setAt: profile?.setAt ?? null,
    rules: profile?.rules ?? null,
    why: list[0]?.origin?.love ?? null,
    site,
  };
}

/** Read ?format=&theme=&layout=&headline=&rules= on top of a saved style. */
export function cardRequest(url: URL, saved: string | null) {
  const q = url.searchParams;
  const base = cardOf({ card: saved });
  const style: CardStyle = zCard.parse({
    theme: q.get("theme") ?? base.theme,
    layout: q.get("layout") ?? base.layout,
    headline: q.has("headline") ? (q.get("headline") ?? "") : base.headline,
    showRules: q.has("rules") ? q.get("rules") !== "0" : base.showRules,
  });
  const f = q.get("format");
  const format: CardFormat = f && f in CARD_FORMATS ? (f as CardFormat) : "story";
  return { style, format };
}

export const siteHost = (req: Request) => new URL(req.url).host.replace(/^www\./, "");
