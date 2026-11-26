import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable} ${roman.variable} ${garamond.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header data-site-header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-center gap-5 px-5 py-4 text-sm">
            <Link href="/" className="rank-num text-2xl tracking-tight">
              All-Timers
            </Link>
            {user && (
              <>
                <Link href={`/u/${user.handle}`} className="text-muted hover:text-foreground">
                  My list
                </Link>
                <Link href="/compare" className="text-muted hover:text-foreground">
                  Compare
                </Link>
                <span className="flex-1" />
                <Link href="/settings" className="flex items-center gap-2 text-muted hover:text-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: user.color }} />
                  {user.name}
                </Link>
              </>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
      </body>
    </html>
  );
}
