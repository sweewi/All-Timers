"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth";
import { isSandbox } from "@/lib/sandbox";
import { DEMO_PEOPLE, demoUserId } from "@/db/demo/seed";

/** Preview sandbox only: switch which demo member this browser is signed in as. */
export async function viewAs(handle: string) {
  if (!isSandbox()) throw new Error("Not available");
  if (!DEMO_PEOPLE.some((p) => p.handle === handle)) throw new Error("Unknown demo member");
  await endSession();
  await startSession(demoUserId(handle));
  refresh();
  redirect("/");
}
