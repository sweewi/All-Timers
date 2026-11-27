import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guideStatus } from "@/lib/guide";

/** The guide's setup checklist for the signed-in member. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });
  return NextResponse.json(await guideStatus(user));
}
