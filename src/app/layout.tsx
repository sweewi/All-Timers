import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import Link from "next/link";
import { Guide, HelpButton } from "@/components/Guide";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";
import { World } from "@/components/World";
import { Footpath } from "@/components/Footpath";
import { SpeedInsights } from "@vercel/speed-insights/next";

const roman = localFont({
  src: [
    { path: "../../node_modules/@fontsource/cinzel/files/cinzel-latin-500-normal.woff2", weight: "500" },
    { path: "../../node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-roman",
});
const garamond = localFont({
  src: [
    { path: "../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2", weight: "500", style: "italic" },
  ],
  variable: "--font-garamond",
});
const body = localFont({
  src: [
    { path: "../../node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-body",
});
const tall = localFont({
  src: [
    { path: "../../node_modules/@fontsource/oswald/files/oswald-latin-200-normal.woff2", weight: "200" },
    { path: "../../node_modules/@fontsource/oswald/files/oswald-latin-300-normal.woff2", weight: "300" },
    { path: "../../node_modules/@fontsource/oswald/files/oswald-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-tall",
});
const display = localFont({
  src: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "All-Timers",
  description: "Your friends' all-time favorite songs, ranked.",
};

// Every page is per-user and reads the database, so render on each request.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable} ${roman.variable} ${garamond.variable} ${body.variable} ${tall.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <World />
        <header data-site-header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-center gap-5 px-5 py-4 text-sm">
            <Link href="/" className="brand">
              All<i>·</i>Timers
            </Link>
            {user && (
              <>
                <Link href={`/u/${user.handle}`} className="text-muted hover:text-foreground">
                  My column
                </Link>
                <Link href="/month" className="text-muted hover:text-foreground">
                  This month
                </Link>
                <Link href="/compare" className="hidden text-muted hover:text-foreground sm:inline">
                  Compare
                </Link>
                <Link href="/me/stories" className="hidden text-muted hover:text-foreground md:inline">
                  Why room
                </Link>
                <span className="flex-1" />
                <HelpButton />
                <Link href="/settings" className="flex flex-none items-center gap-2 text-muted hover:text-foreground" aria-label="Settings">
                  <span className="h-3 w-3 rounded-full" style={{ background: user.color }} />
                  <span className="nav-name">{user.name}</span>
                </Link>
              </>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
        {user && <Footpath handle={user.handle} />}
        {user && <Guide autoOpen={!user.guideSeenAt} />}
        <SpeedInsights />
      </body>
    </html>
  );
}
