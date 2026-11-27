"use client";

import { useState, useTransition } from "react";
import {
  connectStatsfmAction,
  disconnectStatsfmAction,
  refreshStatsfmNow,
  setStatsfmSwitch,
} from "./actions";

export type StatsfmView = {
  displayName: string;
  customId: string | null;
  imageUrl: string | null;
  status: "ok" | "gone" | "error";
  showLive: boolean;
  showPlays: boolean;
  hidden: { live: boolean; tops: boolean; totals: boolean };
  streams: number | null;
  hours: number | null;
  synced: string | null;
  isPlus: boolean;
  syncing: boolean | null;
  imported: boolean | null;
  recentStreams: number | null;
  recentTracks: number | null;
  repeats: boolean;
};

const btn = "rounded-full border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent disabled:opacity-50";

export function StatsfmPanel({ account }: { account: StatsfmView | null }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Already on stats.fm? Link your profile and your columns show real play counts, the plaza shows what you&apos;re
          playing, and your month&apos;s top songs go into the group&apos;s monthly list. Nothing is shared until you link it,
          and your stats.fm privacy settings always win.
        </p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const r = await connectStatsfmAction(value);
              if (!r.ok) setMsg(r.message);
            });
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="username or stats.fm/user/… link"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={300}
            className="min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none focus:border-accent"
          />
          {(
            <button
              type="button"
              className={btn}
              onClick={async () => {
                try {
                  const t = await navigator.clipboard?.readText();
                  if (t) setValue(t.trim().slice(0, 300));
                } catch {
                  setMsg("Couldn't read the clipboard. Paste it in instead.");
                }
              }}
            >
              Paste
            </button>
          )}
          <button disabled={pending || !value.trim()} className={btn}>
            {pending ? "Checking…" : "Link stats.fm"}
          </button>
        </form>
        {msg && <p className="text-sm text-red-700">{msg}</p>}
        <p className="text-xs text-muted">
          In the stats.fm app: Profile → Share → Copy link. Or just type your username.
        </p>
      </div>
    );
  }

  const handle = account.customId;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm">
          <div className="font-medium">{account.displayName}</div>
          {handle && (
            <a href={`https://stats.fm/user/${encodeURIComponent(handle)}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent">
              stats.fm/user/{handle} ↗
            </a>
          )}
        </div>
        {account.streams != null && (
          <div className="text-right text-xs text-muted">
            <div className="rank-num text-lg text-ink">{account.streams.toLocaleString()}</div>
            plays{account.hours != null && ` · ${account.hours.toLocaleString()} h`}
          </div>
        )}
      </div>

      <Health a={account} />

      {account.status === "gone" && (
        <p className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-700">
          stats.fm can&apos;t find this account anymore (renamed or deleted?). Unlink and link it again.
        </p>
      )}
      {account.status === "error" && (
        <p className="text-xs text-muted">Last refresh didn&apos;t go through. It&apos;ll retry on its own.</p>
      )}

      <div className="space-y-2">
        <Switch
          label="Show my play counts on my column"
          on={account.showPlays}
          disabled={account.hidden.tops}
          note={account.hidden.tops ? "Your stats.fm profile hides top tracks, so there's nothing to show." : undefined}
          set={(v) => setStatsfmSwitch("showPlays", v)}
        />
        <Switch
          label="Show what I'm playing on the plaza"
          on={account.showLive}
          disabled={account.hidden.live}
          note={account.hidden.live ? "Your stats.fm profile hides currently playing." : "Only your crew sees it, and only while you're actually playing."}
          set={(v) => setStatsfmSwitch("showLive", v)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <RefreshButton />
        <button
          type="button"
          disabled={pending}
          className="text-sm text-muted hover:text-red-700"
          onClick={() => {
            if (!confirm("Unlink stats.fm? Your play counts and listening history are deleted from All-Timers.")) return;
            start(() => disconnectStatsfmAction());
          }}
        >
          Unlink and delete my listening data
        </button>
      </div>
      {account.synced && <p className="text-xs text-muted">Synced {account.synced}. Data from stats.fm.</p>}
    </div>
  );
}

function Switch({ label, on, set, disabled, note }: { label: string; on: boolean; set: (v: boolean) => Promise<void>; disabled?: boolean; note?: string }) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState(on);
  const checked = disabled ? false : optimistic;
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="mt-1 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled || pending}
        onChange={(e) => {
          const v = e.target.checked;
          setOptimistic(v);
          start(async () => {
            try {
              await set(v);
            } catch {
              setOptimistic(!v);
            }
          });
        }}
      />
      <span>
        {label}
        {note && <span className="block text-xs text-muted">{note}</span>}
      </span>
    </label>
  );
}

function RefreshButton() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button type="button" disabled={pending} className={btn} onClick={() => start(async () => setRes(await refreshStatsfmNow()))}>
        {pending ? "Refreshing…" : "Refresh now"}
      </button>
      {res && <span className="text-xs text-muted">{res}</span>}
    </span>
  );
}

/** What stats.fm actually has for this person, and what to do about gaps. */
function Health({ a }: { a: StatsfmView }) {
  const notes: React.ReactNode[] = [];
  if (a.syncing === false && !a.isPlus) {
    notes.push(
      <>
        <b>Free stats.fm records a sample of your listening, not every play</b>
        {a.recentStreams != null && ` (${a.recentStreams} plays in the last 4 weeks)`}. Full play-by-play sync comes with stats.fm Plus, so
        counts here undercount what you really play.
      </>,
    );
  } else if (a.syncing === false) {
    notes.push(
      <>
        stats.fm&apos;s full sync looks off for you, so it may miss plays
        {a.recentStreams != null && ` (${a.recentStreams} plays in the last 4 weeks)`}. With Plus you can turn it on in the stats.fm app:
        Settings → Connections → Sync streams.
      </>,
    );
  }
  if (!a.repeats) {
    notes.push(
      <>
        Lately stats.fm has about one play per song ({a.recentStreams} plays, {a.recentTracks} songs), so there&apos;s no real &ldquo;most
        played&rdquo; yet. Until there are repeats, your plays won&apos;t pick songs for the monthly list; nominate songs there instead.
      </>,
    );
  }
  if (!a.isPlus) {
    notes.push(
      <>
        Free stats.fm also hides play counts for 4-week, 6-month and lifetime lists, so your column shows ranks (&ldquo;#12 most
        played&rdquo;) instead of counts.{a.imported === false && " Importing your full Spotify history (for accurate lifetime numbers) needs Plus too."}
      </>,
    );
  }
  if (!notes.length) return null;
  return (
    <ul className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-[#5b4a1f]">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}
