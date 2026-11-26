"use client";

import { useState, useTransition } from "react";
import { CopyButton } from "@/components/client";

export function LinkMaker({ make, label }: { make: () => Promise<string>; label: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return link ? (
    <span className="flex items-center gap-2">
      <CopyButton text={link} label="Copy sign-in link" />
      <span className="text-xs text-muted">works once, for 24 hours</span>
    </span>
  ) : (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => setLink(await make()))}
      className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {pending ? "Making…" : label}
    </button>
  );
}
