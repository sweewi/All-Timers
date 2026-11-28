"use client";

import { useState, useTransition } from "react";

export function ActionButton({ run, label }: { run: () => Promise<string>; label: string }) {
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await run()))}
        className="btn btn-marble btn-sm"
      >
        {pending ? "Working…" : label}
      </button>
      {result && <span className="text-sm text-muted">{result}</span>}
    </span>
  );
}
