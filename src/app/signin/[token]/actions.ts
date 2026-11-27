"use server";

import { redirect } from "next/navigation";
import { redeemLoginLink, startSession } from "@/lib/auth";
import { budget, clientAddress } from "@/lib/guard";

export async function redeemSignIn(formData: FormData) {
  await budget("join", await clientAddress());
  const token = String(formData.get("token") ?? "").slice(0, 128);
  const userId = /^[A-Za-z0-9_-]{16,128}$/.test(token) ? await redeemLoginLink(token) : null;
  if (!userId) redirect(`/signin/${encodeURIComponent(token || "x")}`);
  await startSession(userId);
  redirect("/");
}
