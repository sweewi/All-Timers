import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
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
    crewId: text("crew_id")
      .notNull()
      .references(() => crews.id),
    name: text("name").notNull(),
    handle: text("handle").notNull().unique(),
    color: text("color").notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_crew_idx").on(t.crewId)],
);

/** One row per signed-in browser. The cookie holds the raw token; we store its hash. */
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
    metaSource: text("meta_source").notNull(), // spotify (API) | page (public pages) | oembed | none
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

/** Small key/value store (e.g. the app owner's Spotify refresh token). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type Origin = typeof origins.$inferSelect;
