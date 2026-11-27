"use client";

import { useTransition } from "react";
import { switchGroup } from "@/app/actions";

export function GroupList({ groups }: { groups: { id: string; name: string; admin: boolean; current: boolean }[] }) {
  const [pending, start] = useTransition();
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line">
      {groups.map((g) => (
        <li key={g.id} className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="flex-1">
            {g.name} {g.admin && <span className="text-xs text-accent">admin</span>}
          </span>
          {g.current ? (
            <span className="text-xs text-muted">viewing now</span>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="btn btn-marble btn-sm"
              onClick={() => start(() => switchGroup(g.id))}
            >
              Switch to it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
