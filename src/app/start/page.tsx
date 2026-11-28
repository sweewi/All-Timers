import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Altitude } from "@/components/World";
import { startFresh } from "../actions";

export const metadata: Metadata = { title: "Start your All-Timers", description: "Your all-time favorite songs, in order, next to your friends'." };

export default async function Start({ searchParams }: PageProps<"/start">) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-xl py-10">
      <Altitude base={0.3} range={0.1} />
      <h1 className="tall-h text-[clamp(56px,12vw,110px)]">Which songs are your All-Timers?</h1>
      <p className="tall-sub mt-4">
        The handful of songs that get you the most, in order, with why they made it. Make yours, then bring your friends.
      </p>
      <form action={startFresh} className="note note-blue mt-8 grid gap-4">
        <label className="grid gap-1">
          <span className="text-sm">My name</span>
          <input name="name" required maxLength={40} className="field" autoComplete="given-name" />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">Name for my group (optional)</span>
          <input name="crewName" maxLength={60} className="field" placeholder="e.g. The Boys, Saturday Club" />
        </label>
        {sp.error === "name" && <p className="text-sm text-[#a2432f]">Put a name in so friends know whose list it is.</p>}
        <button className="btn btn-gold btn-lg justify-self-start">Start my list</button>
        <p className="text-xs text-muted">
          No password: this device stays signed in. You&apos;ll get an invite link for your friends, and you can sign in on other devices from
          Settings.
        </p>
      </form>
    </div>
  );
}
