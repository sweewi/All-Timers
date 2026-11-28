"use client";

import { useState, useTransition } from "react";
import { nominateAction } from "./actions";

export function NominateForm({ month }: { month: string }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await nominateAction(month, value);
          setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Added") : r.message });
          if (r.ok) setValue("");
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://open.spotify.com/track/…"
        maxLength={500}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="field"
      />
      <button
        type="button"
        className="btn btn-marble btn-sm"
        onClick={async () => {
          try {
            const t = await navigator.clipboard?.readText();
            if (t) setValue(t.trim().slice(0, 500));
          } catch {
            setMsg({ ok: false, text: "Couldn't read the clipboard. Paste it in instead." });
          }
        }}
      >
        Paste
      </button>
      <button disabled={pending || !value.trim()} className="sticker sticker-steal sticker-lg">
        {pending ? "Adding…" : "Nominate"}
      </button>
      {msg && <p className={`w-full text-sm ${msg.ok ? "text-[#2f8f5b]" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}
