"use client";

import { useState, useTransition } from "react";
import { LinkMaker } from "./LinkMaker";
import { makeLoginLinkFor, removeMember, setAdmin } from "./actions";

export type MemberView = { id: string; name: string; color: string; isAdmin: boolean; isMe: boolean; songs: number };

/** One member in the admin list: sign-in rescue link, admin on/off, and remove (typed confirmation). */
export function MemberRow({ m }: { m: MemberView }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
        <span className="min-w-0 flex-1">
          {m.name} {m.isMe && <span className="text-xs text-muted">(you)</span>}{" "}
          {m.isAdmin && <span className="text-xs text-accent">admin</span>}
          <span className="block text-xs text-muted">{m.songs ? `${m.songs} songs` : "no list yet"}</span>
        </span>
        {!m.isMe && (
          <>
            <LinkMaker make={makeLoginLinkFor.bind(null, m.id)} label="Sign-in link" />
            <button
              type="button"
              disabled={pending}
              className="rounded-full border border-line px-3 py-1.5 hover:border-accent disabled:opacity-50"
              onClick={() =>
                start(async () => {
                  const r = await setAdmin(m.id, !m.isAdmin);
                  setMsg({ ok: r.ok, text: r.message });
                })
              }
            >
              {m.isAdmin ? "Remove admin" : "Make admin"}
            </button>
            <button type="button" className="text-muted hover:text-red-700" onClick={() => setConfirming((v) => !v)}>
              Remove…
            </button>
          </>
        )}
      </div>
      {confirming && (
        <form
          className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await removeMember(m.id, typed);
              setMsg({ ok: r.ok, text: r.message });
              if (r.ok) setConfirming(false);
            });
          }}
        >
          <p className="text-red-800">
            This deletes {m.name}&apos;s lists, stories, reactions, listening data and votes, and signs them out everywhere. It can&apos;t
            be undone. Songs they put you on to stay on your list, just without their name.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type ${m.name} to confirm`}
              className="min-w-0 flex-1 rounded-full border border-red-200 bg-white px-3 py-1.5"
              autoComplete="off"
            />
            <button
              disabled={pending || typed.trim().toLowerCase() !== m.name.trim().toLowerCase()}
              className="rounded-full bg-red-700 px-4 py-1.5 font-medium text-white disabled:opacity-40"
            >
              {pending ? "Removing…" : `Remove ${m.name}`}
            </button>
            <button type="button" className="px-2 text-muted" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
    </li>
  );
}
