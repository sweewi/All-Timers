# All-Timers

Your crew's all-time favorite songs, ranked. A place to see everyone's lists, compare them, and keep the stories of where each song came from.

**Built so far:** paste-in import from Spotify, ranked All-Time and On Deck lists, a one-song-at-a-time "why it's here" story mode (what you love about it, favorite moment, how it found you, the memory), put-ons, compare two people, a feed, invite links.
**Next:** monthly group lists (auto-drafted, voted, turned into a playlist), reactions and comments.

## How it works

- **Spotify is the source, not the database.** Spotify only lets small apps sign in 5 users and won't let them read other people's playlists, so people copy their songs out of Spotify and paste them in. The app keeps the ranking, history and stories.
- **One group per site.** Whoever opens the site first starts the group and gets the invite link; everyone else joins that same group through it. Nobody creates their own.
- **No passwords or email.** Joining from the invite link signs that device in. Settings → "Make a sign-in link" signs in another device. The admin can make a rescue link for anyone.
- **Exact versions matter.** A song is stored as the exact Spotify track. Comparisons match by ISRC (same recording) and flag "same song, different version" by title + artist.
- **Every list change is logged** (`rank_events`), which powers the feed and later history and climbers.

## Run it locally

```bash
npm install
npm run seed     # optional: demo crew of 3; prints sign-in links
npm run dev
```

With no `DATABASE_URL`, the app uses an embedded Postgres in `./.pglite` (created and migrated automatically). Delete that folder to start over. On first visit with an empty database you'll be asked to create the crew.

## Deploy on Vercel

1. **Import the repo** in Vercel (New Project → this repo). Framework: Next.js, defaults are fine.
2. **Add a database:** project → Storage → Create → **Neon** (Postgres). This sets `DATABASE_URL`. Migrations run automatically during every build (`npm run build` runs `db:migrate` first).
3. **Spotify keys (optional).** Without them, song details (title, every artist, album, year, cover art and its color) come from Spotify's public song pages. Keys add the ISRC, which lets Compare match the same recording across the single and the album:
   - Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create app. (Spotify requires the app owner to have Premium.)
   - Redirect URI: `https://YOUR-APP.vercel.app/api/spotify/callback` (and `http://127.0.0.1:3000/api/spotify/callback` for local; Spotify no longer accepts `localhost`).
   - API: **Web API**.
   - In Vercel → Settings → Environment Variables add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, then redeploy.
4. **Open the site**, create the crew (you become admin), and import your list.
5. **The hub account (optional, for the monthly playlist).** Make a separate free Spotify account for the group (e.g. "All-Timers"; sign up with email, not "Continue with Google/Apple", so it isn't tied to yours). In the Spotify developer dashboard → your app → **User Management**, add the hub account's email. Then, in a private browser window logged into Spotify *as the hub*, open the site → **Settings → Connect the hub account**. Each month's playlist lives there: created once the pool has songs, growing with it, reordered into the final ranking at the reveal. Only the developer (you) needs Premium; the hub can be free. Spotify's development mode allows 5 signed-in accounts per app, which is why it's one hub rather than everyone's own.
6. **Cron secret.** Add `CRON_SECRET` (any random string of 16+ characters, e.g. `openssl rand -hex 24`). Vercel sends it to `/api/cron/daily` once a day (see `vercel.json`); without it the route refuses every call.
7. **Settings → Refresh song details** if you imported songs before adding the Spotify keys.
8. Copy the invite link from the home page and send it to the group.

## Environment variables

| Name | Needed | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | Production | Neon Postgres connection string (set by the Vercel Neon integration) |
| `SPOTIFY_CLIENT_ID` | Optional | ISRC lookups and the owner's Spotify connection (needed for group playlists later) |
| `SPOTIFY_CLIENT_SECRET` | Optional | Same |
| `CRON_SECRET` | Production | Bearer secret for the daily job (listening refresh, monthly reveal, playlist sync, cleanup) |
| `APP_TIMEZONE` | No | IANA zone for calendar months and the 8 pm reveal (default `America/New_York`) |
| `PGLITE_DIR` | No | Where the local embedded database lives (default `./.pglite`) |

## Listening data (stats.fm)

Members can link their [stats.fm](https://stats.fm) profile in Settings (username or profile link). It's opt-in, the stats.fm privacy settings always win, and unlinking deletes everything we cached. With it:

- columns show lifetime play counts per song ("412 plays", or "under 10 plays" past the top 1,000)
- the plaza shows who's playing what right now (polled about once a minute while the page is open)
- **On repeat**: everyone's most-played of the last four weeks, stealable
- **You keep playing these**: songs you replay that aren't on your lists, on the On Deck page
- **The monthly list** (`/month`): each person's top 5 by plays in the calendar month (weighted so everyone counts equally) plus up to 3 nominations each; everyone ranks a secret ballot; the group list is revealed at 8 pm on the last day (averaged Borda count). With a hub account connected, the month has a Spotify playlist everyone can save: the pool while voting is open, the final order after the reveal. Each pool card also has a quick-listen player (full songs if you're logged into Spotify in that browser, otherwise 30-second previews)

Being a good guest to an unofficial API: requests are throttled (2 at a time), cached (4 h to 24 h depending on the data), refreshed after pages render rather than during, backed off on 429, and the site works without it.

## Admin, guide

- **Admins** (Settings → Members): make sign-in links for anyone who lost access, make or remove admins (there's always at least one), and remove a member with all their data (typed confirmation). Anyone can invite people with the invite link.
- **The guide**: opens by itself on someone's first visit (setup checklist with live status, then a tour with examples), resumes after they import their list, and reopens any time from the **?** in the header. Seen-state is stored per member (`users.guide_seen_at`).

## Safety

- Every outbound request goes through `src/lib/net.ts`: host allowlist (Spotify, stats.fm), HTTPS only, redirects re-checked, timeouts, size caps, retries with backoff, per-host circuit breaker
- Every server action validates its input with zod (`src/lib/guard.ts`) and is rate limited per user (Postgres-backed, so it holds across serverless instances)
- Security headers and a CSP in `next.config.ts`; `/api/*` is `no-store`
- Sessions and sign-in links are stored hashed; sign-in links are single use and expire in 24 h

## Tests

```bash
npm test                                   # pure logic: pool weighting, ballot tally, parsers, month windows
PGLITE_DIR=/tmp/scratch node --conditions=react-server --import tsx scripts/smoke-reveal.ts   # against a scratch DB copy
```

## Code map

- `src/db/schema.ts`: tables (crews, users, sessions, tracks, list_entries, origins, rank_events, reactions, settings, statsfm_accounts, listen_tops, listen_syncs, now_playing, monthly_rounds/pool/ballots/results, rate_limits, spotify_mirrors)
- `src/lib/net.ts` · `guard.ts` · `ratelimit.ts`: the safety layer
- `src/lib/statsfm.ts` (client) · `listening.ts` (cache + sync) · `monthly-math.ts` (pure) · `monthly.ts` (rounds) · `mirror.ts` (monthly playlist on the hub account) · `playlist.ts` (one-link import)
- `src/lib/spotify.ts`: link parsing, track lookups (Spotify API if keys work, plus Spotify's public song pages; oEmbed last), and a backfill that heals title-only songs after pages load
- `src/lib/lists.ts`: reading and saving lists, change log, crew overview and feed
- `src/lib/songs.ts`: version and song identity (ISRC vs title + artist)
- `src/app/me/import`: paste-in walkthrough · `src/app/me/stories`: one-song-at-a-time "why it's here" · `src/app/me/edit`: drag to reorder
- `src/app/u/[handle]`: profiles · `src/app/compare`: two-person comparison

Change the schema in `src/db/schema.ts`, then run `npm run db:generate` and commit the new file in `drizzle/`.
