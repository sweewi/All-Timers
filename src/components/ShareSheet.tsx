"use client";

import { useEffect, useState } from "react";

/**
 * Sending something to the group chat: the phone's share sheet where there is one,
 * a ready-to-send text message, and copy as the fallback everywhere. Links carry a
 * preview card (Open Graph image), so what lands in the chat already looks good.
 */
export function ShareSheet({
  path,
  message,
  label = "Share",
  className = "",
  primary = true,
}: {
  /** site path ("/s/abc") or full URL */
  path: string;
  /** the words sent with the link; the link is appended */
  message: string;
  label?: string;
  className?: string;
  primary?: boolean;
}) {
  const [canShare, setCanShare] = useState(false);
  const [sms, setSms] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const url = () => (path.startsWith("/") ? `${window.location.origin}${path}` : path);
  const full = () => `${message} ${url()}`;
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- feature checks after hydration */
    setCanShare("share" in navigator);
    // iOS Messages reads "sms:&body=", everything else "sms:?body="
    setSms(`sms:${/iPhone|iPad|iPod/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(full())}`);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- message/path are fixed per render
  }, [path, message]);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {canShare ? (
        <button
          type="button"
          className={`btn ${primary ? "btn-gold" : "btn-marble"} btn-sm`}
          onClick={() => navigator.share({ text: message, url: url() }).catch(() => {})}
        >
          {label}
        </button>
      ) : (
        <a className={`btn ${primary ? "btn-gold" : "btn-marble"} btn-sm`} href={sms}>
          Text it
        </a>
      )}
      {canShare && (
        <a className="btn btn-marble btn-sm" href={sms}>
          Text it
        </a>
      )}
      <button
        type="button"
        className="btn btn-marble btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(full());
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
