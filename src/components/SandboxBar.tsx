import { isSandbox } from "@/lib/sandbox";
import { DEMO_PEOPLE } from "@/db/demo/seed";
import { viewAs } from "@/app/sandbox/actions";

/** A strip at the top of preview deployments: says it's a sandbox and lets the reviewer be anyone. */
export function SandboxBar({ current }: { current?: string }) {
  if (!isSandbox()) return null;
  return (
    <div className="sandbox-bar">
      <p>
        <b>Preview sandbox.</b> Demo people, demo data. Nothing here touches the real site, and it resets on its own.
      </p>
      <div className="sandbox-who" role="group" aria-label="View as">
        <span>View as</span>
        {DEMO_PEOPLE.map((p) => (
          <form key={p.handle} action={viewAs.bind(null, p.handle)}>
            <button type="submit" aria-pressed={current === p.handle} style={{ ["--dot" as string]: p.color }}>
              {p.name}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
