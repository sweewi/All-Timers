import Link from "next/link";
import { peekLoginLink } from "@/lib/auth";
import { Altitude } from "@/components/World";
import { redeemSignIn } from "./actions";

/** Opening a sign-in link shows who it's for; tapping the button spends it. */
export default async function SignInPage({ params }: PageProps<"/signin/[token]">) {
  const { token } = await params;
  const who = await peekLoginLink(token);
  return (
    <div className="join-page mx-auto max-w-md py-2">
      <Altitude base={0} range={0.06} />
      {who ? (
        <form action={redeemSignIn} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-sm uppercase tracking-widest text-muted">Sign in on this device</p>
          <h1 className="rank-num text-5xl">
            <span className="mr-3 inline-block h-4 w-4 rounded-full align-middle" style={{ background: who.color }} />
            {who.name}
          </h1>
          <button className="rounded-full bg-accent px-6 py-2.5 font-medium text-black">Sign in as {who.name}</button>
          <p className="text-xs text-muted">This link works once. After you tap the button, this device stays signed in.</p>
        </form>
      ) : (
        <div className="space-y-3">
          <h1 className="rank-num text-4xl">That link has expired</h1>
          <p className="text-muted">
            Sign-in links work once and last 24 hours. On a device where you&apos;re already signed in, go to Settings → Your other
            devices and make a new one. Lost every device? Ask an admin in your group for a link.
          </p>
          <Link href="/" className="text-accent underline-offset-4 hover:underline">
            Go to the front page
          </Link>
        </div>
      )}
    </div>
  );
}
