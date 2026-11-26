import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCrewMembers } from "@/lib/lists";
import { signOut } from "@/app/actions";
import { ShareInvite } from "@/components/ShareInvite";
import { LinkMaker } from "./LinkMaker";
import { makeLoginLinkFor, makeMyLoginLink, refreshSongDetails } from "./actions";
import { ActionButton } from "./ActionButton";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const members = user.isAdmin ? await getCrewMembers(user.crewId) : [];
  const spotifyConnected =
    user.isAdmin &&
    (await db.select().from(schema.settings).where(eq(schema.settings.key, "spotify_refresh_token"))).length > 0;
  const hasSpotifyApp = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="rank-num text-5xl">Settings</h1>

      <section className="space-y-3">
        <h2 className="font-medium">Sign in on another device</h2>
        <p className="text-sm text-muted">
          There are no passwords. Make a link here and open it on your phone or laptop to sign in there.
        </p>
        <LinkMaker make={makeMyLoginLink} label="Make a sign-in link" />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Invite people to {crew.name}</h2>
        <ShareInvite path={`/join/${crew.inviteCode}`} groupName={crew.name} />
      </section>

      {user.isAdmin && (
        <>
          <section className="space-y-3">
            <h2 className="font-medium">Members</h2>
            <p className="text-sm text-muted">If someone loses access, make them a sign-in link and send it to them.</p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                  <span className="flex-1">
                    {m.name} {m.isAdmin && <span className="text-xs text-muted">(admin)</span>}
                  </span>
                  {m.id !== user.id && <LinkMaker make={makeLoginLinkFor.bind(null, m.id)} label="Sign-in link" />}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-medium">Spotify</h2>
            {!hasSpotifyApp ? (
              <p className="text-sm text-muted">
                Not set up. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the environment (see README) so imports
                get artist, album, year and version data.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Song lookups use the app&apos;s Spotify keys. Connecting your own account is a backup for lookups and is
                  needed later to create the group&apos;s monthly playlists on your account.
                </p>
                <div className="flex items-center gap-3">
                  <a href="/api/spotify/login" className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                    {spotifyConnected ? "Reconnect Spotify" : "Connect my Spotify"}
                  </a>
                  {spotifyConnected && <span className="text-sm text-green-400">Connected</span>}
                  {sp.spotify === "error" && <span className="text-sm text-red-400">That didn&apos;t work. Try again.</span>}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <ActionButton run={refreshSongDetails} label="Refresh song details" />
                  <span className="text-xs text-muted">Fills in artist, album and version for songs added before the keys were set.</span>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <form action={signOut}>
        <button className="text-sm text-muted hover:text-red-400">Sign out of this device</button>
      </form>
    </div>
  );
}
