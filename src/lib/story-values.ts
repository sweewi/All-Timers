import type { Entry } from "./lists";
import type { StoryValues } from "@/components/StoryForm";

export function toStoryValues(o: Entry["origin"]): StoryValues {
  return {
    foundVia: o?.foundVia ?? (o?.fromUserId ? "friend" : o?.fromName ? "someone" : null),
    fromUserId: o?.fromUserId ?? null,
    fromName: o?.fromName ?? null,
    love: o?.love ?? "",
    moment: o?.moment ?? "",
    whenText: [o?.whenText, o?.whereText].filter(Boolean).join(", "),
    story: o?.story ?? "",
  };
}

export function hasStory(o: Entry["origin"]) {
  return Boolean(o && (o.love || o.moment || o.foundVia || o.fromUserId || o.fromName || o.story));
}
