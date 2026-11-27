import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCrewMembers, getCrewOverview } from "@/lib/lists";
import { signOut } from "@/app/actions";
import { ShareInvite } from "@/components/ShareInvite";
import { LinkMaker } from "./LinkMaker";
import { MemberRow } from "./MemberRow";
import { makeMyLoginLink, refreshSongDetails, syncSpotifyMirrors } from "./actions";
import { ActionButton } from "./ActionButton";
import { Altitude } from "@/components/World";
import { StatsfmPanel, type StatsfmView } from "./StatsfmPanel";
import { getAccount, visibility } from "@/lib/listening";
import { timeAgo } from "@/lib/time";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const members = user.isAdmin ? await getCrewMembers(user.crewId) : [];
  const counts = new Map(
    user.isAdmin ? (await getCrewOverview(user.crewId)).map((o) => [o.member.id, o.count] as const) : [],
  );
  const spotifyConnected =
    user.isAdmin &&
    (await db.select().from(schema.settings).where(eq(schema.settings.key, "spotify_refresh_token"))).length > 0;
  const acct = await getAccount(user.id);
  let statsfm: StatsfmView | null = null;
  if (acct) {
    const v = visibility({ ...acct, showLive: true, showPlays: true });
    const lastSync = (await db.select().from(schema.listenSyncs).where(eq(schema.listenSyncs.userId, user.id)))
      .map((s) => s.fetchedAt.getTime())
      .sort((a, b) => b - a)[0];
    statsfm = {
      displayName: acct.displayName,
      customId: acct.customId,
      imageUrl: acct.imageUrl,
      status: acct.status,
      showLive: acct.showLive,
      showPlays: acct.showPlays,
      hidden: { live: !v.live, tops: !v.tops, totals: !v.totals },
      streams: v.totals ? acct.lifetimeStreams : null,
      hours: v.totals && acct.lifetimeMs != null ? Math.round(Number(acct.lifetimeMs) / 3_600_000) : null,
      synced: lastSync ? timeAgo(lastSync) : null,
    };
  }
  const hasSpotifyApp = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <Altitude base={0.22} range={0.1} />
      <h1 className="rank-num text-5xl">Settings</h1>

      <section className="space-y-3">
        <h2 className="font-medium">Sign in on another device</h2>
        <p className="text-sm text-muted">
          There are no passwords. Make a link here and open it on your phone or laptop to sign in there.
        </p>
        <LinkMaker make={makeMyLoginLink} label="Make a sign-in link" />
      </section>

      <section className="space-y-3" id="statsfm">
        <h2 className="font-medium">Listening (stats.fm)</h2>
        <StatsfmPanel key={acct?.statsfmId ?? "none"} account={statsfm} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Invite people to {crew.name}</h2>
        <ShareInvite path={`/join/${crew.inviteCode}`} groupName={crew.name} />
      </section>

      {user.isAdmin && (
        <>
          <section className="space-y-3" id="members">
            <h2 className="font-medium">Members</h2>
            <p className="text-sm text-muted">
              Admins can make sign-in links for anyone who lost access, make other admins, remove members, and run the Spotify hub.
              Anyone in the group can already invite people with the invite link above; admin isn&apos;t needed for that.
            </p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  m={{ id: m.id, name: m.name, color: m.color, isAdmin: m.isAdmin, isMe: m.id === user.id, songs: counts.get(m.id) ?? 0 }}
                />
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
                  Connect the group&apos;s <b>hub</b> Spotify account here, not your personal one. Each month&apos;s playlist lives on
                  it: created once the pool has songs, growing as it grows, and reordered into the group&apos;s ranking at the reveal.
                  Everyone saves it from the This month page. Tip: log into Spotify as the hub account in a private window, then
                  open this page in that same window and connect.
                </p>
                <div className="flex items-center gap-3">
                  <a href="/api/spotify/login" className="rounded-full border border-line px-4 py-2 text-sm hover:border-accent">
                    {spotifyConnected ? "Reconnect the hub account" : "Connect the hub account"}
                  </a>
                  {spotifyConnected && <span className="text-sm text-green-700">Connected</span>}
                  {sp.spotify === "error" && <span className="text-sm text-red-700">That didn&apos;t work. Try again.</span>}
                </div>
                {spotifyConnected && (
                  <div className="flex items-center gap-3 pt-2">
                    <ActionButton run={syncSpotifyMirrors} label="Sync playlists now" />
                    <span className="text-xs text-muted">It also syncs whenever the pool changes and once a day.</span>
                  </div>
                )}
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
        <button className="text-sm text-muted hover:text-red-700">Sign out of this device</button>
      </form>
    </div>
  );
}
