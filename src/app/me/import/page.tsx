import { requireUser } from "@/lib/auth";
import { ImportClient } from "./ImportClient";
import { Altitude } from "@/components/World";

export default async function ImportPage({ searchParams }: PageProps<"/me/import">) {
  const user = await requireUser();
  const sp = await searchParams;
  const kind = sp.list === "on_deck" ? "on_deck" : "all_time";
  const first = sp.first === "1";
  return (
    <div className="mx-auto max-w-3xl">
      <Altitude base={0.14} range={0.1} />
      {first && <p className="text-sm uppercase tracking-widest text-accent">Welcome, {user.name}</p>}
      <h1 className="rank-num mt-1 text-5xl">
        {kind === "on_deck" ? "Bring in your On Deck list" : "Bring in your all-time list"}
      </h1>
      <p className="mt-3 text-muted">
        Copy the playlist from Spotify and paste it here. The playlist&apos;s order becomes your ranking, so put your #1 at the
        top. You can reorder and add stories after.
      </p>
      <ImportClient kind={kind} handle={user.handle} />
    </div>
  );
}
