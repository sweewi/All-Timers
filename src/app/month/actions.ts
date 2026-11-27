"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { budget, parse, zMonth, zTrackId, zTrackIds } from "@/lib/guard";
import { monthKeyOf } from "@/lib/listening";
import { getRound, MonthlyError, nominate, saveBallot, withdrawNomination } from "@/lib/monthly";
import { RateLimited } from "@/lib/ratelimit";
import { parseTrackInput, resolveTracks } from "@/lib/spotify";
import { z } from "zod";

export type MonthResult = { ok: true; message?: string } | { ok: false; message: string };

/** Only the current month of your own crew can be changed. */
async function openRound(monthIn: string) {
  const user = await requireUser();
  const month = parse(zMonth, monthIn);
  if (month !== monthKeyOf()) throw new MonthlyError("That month is over.");
  const round = await getRound(user.crewId, month);
  if (!round) throw new MonthlyError("No list for that month yet.");
  await budget("monthly", user.id);
  return { user, round };
}

async function guarded(fn: () => Promise<MonthResult>): Promise<MonthResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MonthlyError) return { ok: false, message: e.message };
    if (e instanceof RateLimited) return { ok: false, message: "Easy there. Try again in a moment." };
    throw e;
  }
}

export async function saveBallotAction(month: string, order: string[]): Promise<MonthResult> {
  return guarded(async () => {
    const ids = parse(zTrackIds.max(60), order);
    const { user, round } = await openRound(month);
    const n = await saveBallot(round, user.id, ids);
    refresh();
    return { ok: true, message: n ? `Ballot saved: ${n} ${n === 1 ? "song" : "songs"} ranked.` : "Ballot cleared." };
  });
}

/** Put a song in the pool by Spotify link (3 per person per month). */
export async function nominateAction(month: string, input: string): Promise<MonthResult> {
  return guarded(async () => {
    const text = parse(z.string().max(500), input);
    const { user, round } = await openRound(month);
    const id = parseTrackInput(text).ids[0];
    if (!id) return { ok: false, message: "Paste a Spotify song link (Share → Copy Song Link)." };
    const [track] = await resolveTracks([id]);
    if (!track) return { ok: false, message: "Couldn't find that song on Spotify." };
    await nominate(round, user.id, track.id);
    refresh();
    return { ok: true, message: `${track.name} is in the pool.` };
  });
}

export async function withdrawAction(month: string, trackId: string): Promise<MonthResult> {
  return guarded(async () => {
    const id = parse(zTrackId, trackId);
    const { user, round } = await openRound(month);
    await withdrawNomination(round, user.id, id);
    refresh();
    return { ok: true };
  });
}
