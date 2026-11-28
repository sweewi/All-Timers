"use client";

import { useState, useTransition } from "react";
import type { FoundVia } from "@/db/schema";
import { FOUND_VIA_OPTIONS, promptFor } from "@/lib/stories";
import { saveOrigin } from "@/app/me/edit/actions";
import { CopyButton } from "./client";

export type StoryValues = {
  foundVia: FoundVia | null;
  fromUserId: string | null;
  fromName: string | null;
  love: string;
  moment: string;
  whenText: string;
  story: string;
};

export const emptyStory: StoryValues = {
  foundVia: null,
  fromUserId: null,
  fromName: null,
  love: "",
  moment: "",
  whenText: "",
  story: "",
};

type Member = { id: string; name: string; color: string };

/**
 * The story behind one song. Leads with what the person loves about it, then how
 * the song found them (a friend makes it a put-on), then the memory, all optional.
 */
export function StoryForm({
  trackId,
  trackName,
  initial,
  members,
  inviteCode,
  onSaved,
  saveLabel = "Save",
  autoFocus = false,
}: {
  trackId: string;
  trackName: string;
  initial: StoryValues;
  members: Member[];
  inviteCode: string;
  onSaved?: (values: StoryValues) => void;
  saveLabel?: string;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState<StoryValues>(initial);
  const [showMemory, setShowMemory] = useState(Boolean(initial.story || initial.whenText));
  const [invite, setInvite] = useState<{ originId: string; name: string } | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<StoryValues>) => setV((prev) => ({ ...prev, ...patch }));

  const pickFound = (value: FoundVia) =>
    set(
      v.foundVia === value
        ? { foundVia: null, fromUserId: null, fromName: null }
        : { foundVia: value, fromUserId: value === "friend" ? v.fromUserId : null, fromName: value === "someone" ? v.fromName : null },
    );

  const submit = () =>
    start(async () => {
      const res = await saveOrigin({ trackId, ...v });
      setSavedOnce(true);
      if (res.inviteName) setInvite({ originId: res.originId, name: res.inviteName });
      else onSaved?.(v);
    });

  const input = "w-full rounded-xl border border-line bg-background px-3 py-2.5 text-[15px] placeholder:text-muted/60 focus:border-foreground/40 focus:outline-none";
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${active ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground"}`;

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-lg font-medium" htmlFor={`love-${trackId}`}>
          What do you love about {trackName}?
        </label>
        <textarea
          id={`love-${trackId}`}
          value={v.love}
          onChange={(e) => set({ love: e.target.value })}
          rows={3}
          autoFocus={autoFocus}
          placeholder={promptFor(trackId)}
          className={`${input} mt-2 text-base`}
        />
        <input
          value={v.moment}
          onChange={(e) => set({ moment: e.target.value })}
          placeholder="Favorite moment, e.g. the drop at 2:41"
          className={`${input} mt-2`}
        />
      </div>

      <div>
        <div className="text-sm text-muted">How did it find you?</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {FOUND_VIA_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => pickFound(o.value)} className={chip(v.foundVia === o.value)}>
              {o.chip}
            </button>
          ))}
        </div>
        {v.foundVia === "friend" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {members.length === 0 ? (
              <span className="text-sm text-muted">
                Nobody else has joined yet. Pick &ldquo;Someone else&rdquo; and send them an invite.
              </span>
            ) : (
              members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => set({ fromUserId: m.id })}
                  className={chip(v.fromUserId === m.id)}
                >
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
                  {m.name}
                </button>
              ))
            )}
          </div>
        )}
        {v.foundVia === "someone" && (
          <input
            value={v.fromName ?? ""}
            onChange={(e) => set({ fromName: e.target.value })}
            placeholder="Who? (your brother, a roommate, an ex…)"
            className={`${input} mt-3`}
          />
        )}
      </div>

      {showMemory ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <textarea
            value={v.story}
            onChange={(e) => set({ story: e.target.value })}
            rows={2}
            placeholder="The memory it's tied to: where you were, who you were with…"
            className={input}
          />
          <input
            value={v.whenText}
            onChange={(e) => set({ whenText: e.target.value })}
            placeholder="When, roughly"
            className={`${input} self-start`}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setShowMemory(true)} className="text-sm text-muted hover:text-foreground">
          + Add the memory it&apos;s tied to
        </button>
      )}

      {invite ? (
        <div className="rounded-2xl border border-accent/50 bg-accent/10 p-4 text-sm">
          <b>{invite.name}</b> isn&apos;t here yet. Send them this link; when they join, they get the credit for putting you on.
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={`/join/${inviteCode}?from=${invite.originId}`} label="Copy their invite link" />
            {onSaved && (
              <button type="button" onClick={() => onSaved(v)} className="btn btn-gold btn-sm">
                Continue
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="btn btn-gold"
          >
            {pending ? "Saving…" : saveLabel}
          </button>
          {savedOnce && !onSaved && <span className="text-sm text-muted">Saved</span>}
        </div>
      )}
    </div>
  );
}
