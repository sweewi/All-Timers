import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCrewMembers, getCrewOverview } from "@/lib/lists";
import { signOut } from "@/app/actions";
import { ShareSheet } from "@/components/ShareSheet";
import { LinkMaker } from "./LinkMaker";
import { MemberRow } from "./MemberRow";
import { GroupList } from "./GroupList";
import { createGroup } from "@/app/actions";
import { isSiteAdmin, myGroups } from "@/lib/groups";
import { RenameGroup } from "./RenameGroup";
import { makeMyLoginLink, refreshSongDetails } from "./actions";
import { ActionButton } from "./ActionButton";
import { Altitude } from "@/components/World";
import { StatsfmPanel, type StatsfmView } from "./StatsfmPanel";
import { getAccount, hasRepeats, visibility } from "@/lib/listening";
import { timeAgo } from "@/lib/time";

export default async function SettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const crew = (await db.select().from(schema.crews).where(eq(schema.crews.id, user.crewId)))[0];
  const members = user.isAdmin ? await getCrewMembers(user.crewId) : [];
  const counts = new Map(
    user.isAdmin ? (await getCrewOverview(user.crewId)).map((o) => [o.member.id, o.count] as const) : [],
  );
  const [groups, siteAdmin] = await Promise.all([myGroups(user.id), isSiteAdmin(user.id)]);
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
      showPlays: acct.showPlays,
      hidden: { tops: !v.tops, totals: !v.totals },
      streams: v.totals ? acct.lifetimeStreams : null,
      hours: v.totals && acct.lifetimeMs != null ? Math.round(Number(acct.lifetimeMs) / 3_600_000) : null,
      synced: lastSync ? timeAgo(lastSync) : null,
      isPlus: acct.isPlus,
      syncing: acct.syncing,
      imported: acct.imported,
      recentStreams: acct.recentStreams,
      recentTracks: acct.recentTracks,
      repeats: hasRepeats(acct),
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
          There are no passwords. To use the site on your phone or laptop, make a link here and open it there. It signs in as{" "}
          <b>you</b>, so keep it to yourself.
        </p>
        <LinkMaker make={makeMyLoginLink} label="Make a link for my other device" />
      </section>

      <section className="space-y-3" id="statsfm">
        <h2 className="font-medium">Listening (stats.fm)</h2>
        <StatsfmPanel key={acct?.statsfmId ?? "none"} account={statsfm} />
      </section>

      <section className="space-y-3" id="groups">
        <h2 className="font-medium">Groups</h2>
        <p className="text-sm text-muted">
          Your All-Timers list is the same in every group; each group has its own plaza and feed.
        </p>
        <GroupList groups={groups.map((g) => ({ id: g.crew.id, name: g.crew.name, admin: g.role === "admin", current: g.crew.id === user.crewId }))} />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-foreground">Start a new group</summary>
          <form action={createGroup} className="mt-2 flex flex-wrap gap-2">
            <input
              name="groupName"
              required
              maxLength={60}
              placeholder="e.g. Roommates' All-Timers"
              className="field"
            />
            <button className="btn btn-marble btn-sm">Create</button>
          </form>
          <p className="mt-1 text-xs text-muted">You&apos;ll be its admin, then invite people with its own link.</p>
        </details>
      </section>

      <section className="space-y-3" id="invite">
        <h2 className="font-medium">Invite new people to {crew.name}</h2>
        <p className="text-sm text-muted">For friends joining for the first time: they pick their name and get their own column.</p>
        <ShareSheet path={`/join/${crew.inviteCode}`} label="Share the invite" message={`Come put your all-time favorite songs next to ours on All-Timers (${crew.name}):`} />
      </section>

      {user.isAdmin && (
        <>
          <section className="space-y-3" id="group">
            <h2 className="font-medium">Group name</h2>
            <RenameGroup current={crew.name} />
          </section>

          <section className="space-y-3" id="members">
            <h2 className="font-medium">Members</h2>
            <p className="text-sm text-muted">
              Admins of {crew.name} can make sign-in links for anyone who lost access, make other admins, and remove people from this
              group. Anyone in the group can already invite people with the invite link above; admin isn&apos;t needed for that.
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

          {siteAdmin && (
            <section className="space-y-3">
              <h2 className="font-medium">Song details</h2>
              {hasSpotifyApp ? (
                <div className="flex items-center gap-3">
                  <ActionButton run={refreshSongDetails} label="Refresh song details" />
                  <span className="text-xs text-muted">Fills in artist, album and version for songs added before the Spotify keys were set.</span>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Songs get their details from Spotify&apos;s public pages. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the
                  environment (see README) for version data too.
                </p>
              )}
            </section>
          )}
        </>
      )}

      <form action={signOut}>
        <button className="text-sm text-muted hover:text-red-700">Sign out of this device</button>
      </form>
    </div>
  );
}
