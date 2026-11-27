import {
  doublePrecision,
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** A crew is one friend group. Everyone joins through its invite code. */
export const crews = pgTable("crews", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** the group this person is looking at right now; which groups they belong to is in memberships */
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id),
    name: text("name").notNull(),
    handle: text("handle").notNull().unique(),
    color: text("color").notNull(),
    /** @deprecated admin is per group now: memberships.role. Kept only so old rows stay readable. */
    isAdmin: boolean("is_admin").notNull().default(false),
    /** when they finished or closed the first-run guide; null = show it on next visit */
    guideSeenAt: timestamp("guide_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_crew_idx").on(t.crewId)],
);

/** One row per signed-in browser. The cookie holds the raw token; we store its hash. */
export const MEMBER_ROLES = ["member", "admin"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Who belongs to which group. A person has one All-Timers list wherever they go;
 * groups are the audiences for it (plaza, feed, monthly list, admins).
 */
export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBER_ROLES }).notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.crewId] }), index("memberships_crew_idx").on(t.crewId)],
);
export type Membership = typeof memberships.$inferSelect;

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived links that sign a member in on another device. */
export const loginLinks = pgTable("login_links", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * A Spotify track: one exact version (the single and the album copy of the same
 * recording have different Spotify IDs but share an ISRC).
 */
export const tracks = pgTable(
  "tracks",
  {
    id: text("id").primaryKey(), // Spotify track ID
    name: text("name").notNull(),
    artists: text("artists").notNull().default("[]"), // JSON array of artist names
    album: text("album").notNull().default(""),
    imageUrl: text("image_url"),
    releaseYear: integer("release_year"),
    durationMs: integer("duration_ms"),
    isrc: text("isrc"),
    songKey: text("song_key").notNull(), // normalized title + primary artist
    color: text("color"), // Spotify's background color for this song's art, "#rrggbb"
    metaSource: text("meta_source").notNull(), // spotify (API) | page (public pages) | statsfm | playlist | oembed | none
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tracks_isrc_idx").on(t.isrc), index("tracks_song_key_idx").on(t.songKey)],
);

export const LIST_KINDS = ["all_time", "on_deck"] as const;
export type ListKind = (typeof LIST_KINDS)[number];

/** Each person's ranked songs. position is 1-based and strict (no ties). */
export const listEntries = pgTable(
  "list_entries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ListKind>().notNull(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.trackId] }),
    index("entries_track_idx").on(t.trackId),
  ],
);

export const FOUND_VIA = ["friend", "someone", "grew_up", "myself", "live", "screen", "playlist"] as const;
export type FoundVia = (typeof FOUND_VIA)[number];

/**
 * Where a song came from for one person. It belongs to the person and the song,
 * not the list, so it survives moving a song from On Deck to All-Time.
 * If fromUserId is set, this origin is a put-on.
 */
export const origins = pgTable(
  "origins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    fromName: text("from_name"), // someone outside the app ("my dad")
    foundVia: text("found_via").$type<FoundVia>(), // how the song found them
    love: text("love"), // what they love about it: the heart of the story
    moment: text("moment"), // favorite moment, e.g. "the drop at 2:41"
    whenText: text("when_text"),
    whereText: text("where_text"),
    story: text("story"), // the memory tied to it
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("origins_user_track_idx").on(t.userId, t.trackId),
    index("origins_from_user_idx").on(t.fromUserId),
  ],
);

/** Append-only log of list changes: powers the feed, climbers and history. */
export const rankEvents = pgTable(
  "rank_events",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ListKind>().notNull(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    type: text("type").$type<"add" | "remove" | "move">().notNull(),
    fromPos: integer("from_pos"),
    toPos: integer("to_pos"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_user_idx").on(t.userId), index("events_created_idx").on(t.createdAt)],
);

export const REACTIONS = ["laurel", "fire", "cry", "same"] as const;
export type ReactionKind = (typeof REACTIONS)[number];

/**
 * A friend's reaction to something: a song on someone's column ("song:<ownerId>:<trackId>")
 * or a batch of moves in the feed ("moves:<batchId>"). One of each kind per person.
 */
export const reactions = pgTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    kind: text("kind").$type<ReactionKind>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reactions_user_target_kind_idx").on(t.userId, t.target, t.kind), index("reactions_target_idx").on(t.target)],
);

// ---------------------------------------------------------------------------- stats.fm

export const STATSFM_STATUS = ["ok", "gone", "error"] as const;

/**
 * A member's stats.fm account. We only ever read public data for the username the
 * member gave us, and we keep their own privacy choices (from stats.fm) next to
 * two switches of ours, so they can show less here than they show there.
 */
export const statsfmAccounts = pgTable(
  "statsfm_accounts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    statsfmId: text("statsfm_id").notNull(), // stable stats.fm user id
    customId: text("custom_id"), // their vanity handle, if any
    displayName: text("display_name").notNull(),
    imageUrl: text("image_url"),
    isPlus: boolean("is_plus").notNull().default(false),
    privacy: text("privacy").notNull().default("{}"), // JSON: their stats.fm privacy flags
    showLive: boolean("show_live").notNull().default(true), // our switch: show what I'm playing
    showPlays: boolean("show_plays").notNull().default(true), // our switch: show play counts
    lifetimeStreams: integer("lifetime_streams"),
    lifetimeMs: bigint("lifetime_ms", { mode: "number" }),
    uniqueTracks: integer("unique_tracks"),
    /** stats.fm's own sync of this person's Spotify is on (null = unknown) */
    syncing: boolean("syncing"),
    /** they imported their full Spotify history into stats.fm (needs stats.fm Plus) */
    imported: boolean("imported"),
    /** plays stats.fm recorded in the last 4 weeks, and how many distinct songs: a data-health signal */
    recentStreams: integer("recent_streams"),
    recentTracks: integer("recent_tracks"),
    status: text("status").$type<(typeof STATSFM_STATUS)[number]>().notNull().default("ok"),
    lastError: text("last_error"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("statsfm_accounts_statsfm_id_idx").on(t.statsfmId)],
);

/**
 * Someone's most-played songs for a period, as stats.fm ranks them.
 * period: "lifetime" | "weeks" (last 4 weeks) | "months" (last 6 months) | "m:YYYY-MM" (a calendar month)
 */
export const listenTops = pgTable(
  "listen_tops",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    position: integer("position").notNull(),
    /** null = stats.fm didn't say (free accounts get Spotify's ranking without counts) */
    streams: integer("streams"),
    playedMs: bigint("played_ms", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period, t.trackId] }), index("listen_tops_rank_idx").on(t.userId, t.period, t.position)],
);

/** When each person's period was last fetched, and how deep it goes. */
export const listenSyncs = pgTable(
  "listen_syncs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    rows: integer("rows").notNull(),
    /** play count of the last row: songs not listed have at most this many plays */
    floor: integer("floor"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.period] })],
);

/** The last thing we saw someone playing (cached for about a minute). */
export const nowPlaying = pgTable("now_playing", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  trackId: text("track_id").references(() => tracks.id),
  isPlaying: boolean("is_playing").notNull().default(false),
  progressMs: integer("progress_ms"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------- monthly lists

/** One month's group list for a crew: a pool, everyone's ballot, a reveal. */
export const monthlyRounds = pgTable(
  "monthly_rounds",
  {
    id: text("id").primaryKey(),
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // "YYYY-MM"
    status: text("status").$type<"open" | "revealed">().notNull().default("open"),
    poolBuiltAt: timestamp("pool_built_at", { withTimezone: true }),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("monthly_rounds_crew_month_idx").on(t.crewId, t.month)],
);

/** The songs in a month's pool: from what people actually played, or nominated by hand. */
export const monthlyPool = pgTable(
  "monthly_pool",
  {
    roundId: text("round_id")
      .notNull()
      .references(() => monthlyRounds.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    source: text("source").$type<"plays" | "nomination">().notNull(),
    nominatedBy: text("nominated_by").references(() => users.id, { onDelete: "set null" }),
    /** JSON [{ userId, rank, streams }]: whose month put it here */
    detail: text("detail").notNull().default("[]"),
    weight: real("weight").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.trackId] })],
);

/** One person's ranking of the month's pool. */
export const monthlyBallots = pgTable(
  "monthly_ballots",
  {
    roundId: text("round_id")
      .notNull()
      .references(() => monthlyRounds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    position: integer("position").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.userId, t.trackId] })],
);

/** The revealed group ranking, frozen at reveal time. */
export const monthlyResults = pgTable(
  "monthly_results",
  {
    roundId: text("round_id")
      .notNull()
      .references(() => monthlyRounds.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    position: integer("position").notNull(),
    score: real("score").notNull(),
    voters: integer("voters").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.trackId] })],
);

// ---------------------------------------------------------------------------- plumbing

/** Fixed-window counters for rate limiting actions, shared across server instances. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/** Playlists the app keeps on the owner's Spotify account ("column:<userId>", "month:<roundId>"). */
export const spotifyMirrors = pgTable("spotify_mirrors", {
  key: text("key").primaryKey(),
  playlistId: text("playlist_id").notNull(),
  url: text("url").notNull(),
  snapshotId: text("snapshot_id"),
  /** hash of the track order + phase last pushed, so unchanged syncs cost nothing */
  contentHash: text("content_hash"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  lastError: text("last_error"),
});

/** Small key/value store (e.g. the app owner's Spotify refresh token). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type Origin = typeof origins.$inferSelect;
export type StatsfmAccount = typeof statsfmAccounts.$inferSelect;
export type MonthlyRound = typeof monthlyRounds.$inferSelect;

// ---------------------------------------------------------------------------- ratings

export const RATING_BUCKETS = ["loved", "fine", "disliked"] as const;
export type RatingBucket = (typeof RATING_BUCKETS)[number];

/**
 * Beli-style ratings: a gut bucket, then head-to-head picks place the song in the
 * person's own ranking. `ord` orders songs within a bucket (higher = better; new songs
 * get the midpoint between neighbours). `score` (0–10) is derived from the position and
 * re-derived for the whole bucket on every change, so it's always consistent.
 */
export const ratings = pgTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id),
    bucket: text("bucket", { enum: RATING_BUCKETS }).notNull(),
    ord: doublePrecision("ord").notNull(),
    score: real("score").notNull(),
    /** an optional one-line take */
    note: text("note"),
    /** how many head-to-heads placed it (0 = placed without comparing) */
    comparisons: integer("comparisons").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index("ratings_user_bucket_ord_idx").on(t.userId, t.bucket, t.ord),
    index("ratings_track_idx").on(t.trackId),
    index("ratings_created_idx").on(t.createdAt),
  ],
);
export type Rating = typeof ratings.$inferSelect;

