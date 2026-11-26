import { NextResponse, type NextRequest } from "next/server";
import { redeemLoginLink, startSession } from "@/lib/auth";

export async function GET(request: NextRequest, ctx: RouteContext<"/signin/[token]">) {
  const { token } = await ctx.params;
  const userId = await redeemLoginLink(token);
  if (!userId) return NextResponse.redirect(new URL("/?error=link", request.url));
  await startSession(userId);
  return NextResponse.redirect(new URL("/", request.url));
}
