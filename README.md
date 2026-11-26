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
5. **Settings → Connect my Spotify** (admin, optional now). This is the backup for song lookups and is needed for the monthly group playlists.
6. **Settings → Refresh song details** if you imported songs before adding the Spotify keys.
7. Copy the invite link from the home page and send it to the group.

## Environment variables

| Name | Needed | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | Production | Neon Postgres connection string (set by the Vercel Neon integration) |
| `SPOTIFY_CLIENT_ID` | Optional | ISRC lookups and the owner's Spotify connection (needed for group playlists later) |
| `SPOTIFY_CLIENT_SECRET` | Optional | Same |
| `PGLITE_DIR` | No | Where the local embedded database lives (default `./.pglite`) |

## Code map

- `src/db/schema.ts`: tables (crews, users, sessions, tracks, list_entries, origins, rank_events, settings)
- `src/lib/spotify.ts`: link parsing, track lookups (Spotify API if keys work, plus Spotify's public song pages; oEmbed last), and a backfill that heals title-only songs after pages load
- `src/lib/lists.ts`: reading and saving lists, change log, crew overview and feed
- `src/lib/songs.ts`: version and song identity (ISRC vs title + artist)
- `src/app/me/import`: paste-in walkthrough · `src/app/me/stories`: one-song-at-a-time "why it's here" · `src/app/me/edit`: drag to reorder
- `src/app/u/[handle]`: profiles · `src/app/compare`: two-person comparison

Change the schema in `src/db/schema.ts`, then run `npm run db:generate` and commit the new file in `drizzle/`.
