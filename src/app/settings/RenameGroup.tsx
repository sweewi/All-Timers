"use client";

import { useState, useTransition } from "react";
import { renameGroup } from "./actions";

export function RenameGroup({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = name.trim() !== current && name.trim().length > 0;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await renameGroup(name);
          setMsg({ ok: r.ok, text: r.message });
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        className="min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 py-2 text-sm outline-none focus:border-accent"
      />
      <button disabled={pending || !changed} className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent disabled:opacity-40">
        {pending ? "Saving…" : "Rename"}
      </button>
      {msg && <span className={`w-full text-xs ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</span>}
    </form>
  );
}
