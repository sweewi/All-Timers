"use client";

import { useEffect, useState } from "react";

/** Share sheet on phones, copy-a-ready-message everywhere. */
export function ShareInvite({ path, groupName }: { path: string; groupName: string }) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature check after hydration
    setCanShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);
  const url = () => `${window.location.origin}${path}`;
  const message = () =>
    `I'm putting everyone's all-time favorite songs in one place (${groupName}). Add your list so we can compare: ${url()}`;
  const copy = async (what: "link" | "message") => {
    await navigator.clipboard.writeText(what === "link" ? url() : message());
    setCopied(what);
    setTimeout(() => setCopied(null), 1800);
  };
  const btn = "btn btn-marble btn-sm";
  return (
    <div className="flex flex-wrap gap-2">
      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ text: message() }).catch(() => {})}
          className="btn btn-gold btn-sm"
        >
          Share invite
        </button>
      )}
      <button type="button" onClick={() => copy("message")} className={canShare ? btn : "btn btn-gold btn-sm"}>
        {copied === "message" ? "Copied" : "Copy invite message"}
      </button>
      <button type="button" onClick={() => copy("link")} className={btn}>
        {copied === "link" ? "Copied" : "Copy link only"}
      </button>
    </div>
  );
}
