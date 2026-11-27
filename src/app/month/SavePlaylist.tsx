"use client";

import { useState } from "react";

/**
 * Spotify won't let the site save a playlist into someone's library for them (that
 * needs each person signed in, and development mode allows five). So this does the
 * next best thing: one tap opens the playlist in the Spotify app (on phones the link
 * hands off to the app), with the save step spelled out, plus a link to share.
 */
export function SavePlaylist({ url, revealed }: { url: string; revealed: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="save-playlist">
      <a href={url} target="_blank" rel="noopener noreferrer" className="sticker sticker-steal sticker-lg -rotate-1">
        ▶ Open the playlist in Spotify
      </a>
      <button
        type="button"
        className="sticker sticker-paper"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked: the link still works */
          }
        }}
      >
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <ol className="save-steps">
        <li>Tap the button. It opens in the Spotify app (or the web player on a computer).</li>
        <li>
          Tap <b>⊕</b> (Save to Your Library) under the playlist&apos;s name. It stays in your library and updates by itself.
        </li>
        <li>{revealed ? "It's now in the group's final order." : "Listen through, then come back and rank it below."}</li>
      </ol>
    </div>
  );
}
