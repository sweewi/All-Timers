"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const full = text.startsWith("/") ? `${window.location.origin}${text}` : text;
        await navigator.clipboard.writeText(full);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className={`rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent ${className}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** Spotify's embed player needs no API access and has no user cap. Loaded only when opened. */
export function PlayToggle({ trackId }: { trackId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-muted hover:text-accent"
        aria-expanded={open}
      >
        {open ? "Hide player" : "▶ Play"}
      </button>
      {open && (
        <iframe
          title="Spotify player"
          src={`https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0`}
          width="100%"
          height="80"
          className="mt-2 rounded-xl"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      )}
    </div>
  );
}
