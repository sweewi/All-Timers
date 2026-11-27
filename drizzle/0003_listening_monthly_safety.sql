CREATE TABLE "listen_syncs" (
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"rows" integer NOT NULL,
	"floor" integer,
	CONSTRAINT "listen_syncs_user_id_period_pk" PRIMARY KEY("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "listen_tops" (
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"streams" integer NOT NULL,
	"played_ms" bigint,
	CONSTRAINT "listen_tops_user_id_period_track_id_pk" PRIMARY KEY("user_id","period","track_id")
);
--> statement-breakpoint
CREATE TABLE "monthly_ballots" (
	"round_id" text NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_ballots_round_id_user_id_track_id_pk" PRIMARY KEY("round_id","user_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "monthly_pool" (
	"round_id" text NOT NULL,
	"track_id" text NOT NULL,
	"source" text NOT NULL,
	"nominated_by" text,
	"detail" text DEFAULT '[]' NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_pool_round_id_track_id_pk" PRIMARY KEY("round_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "monthly_results" (
	"round_id" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"score" real NOT NULL,
	"voters" integer NOT NULL,
	CONSTRAINT "monthly_results_round_id_track_id_pk" PRIMARY KEY("round_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "monthly_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"crew_id" text NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"pool_built_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "now_playing" (
	"user_id" text PRIMARY KEY NOT NULL,
	"track_id" text,
	"is_playing" boolean DEFAULT false NOT NULL,
	"progress_ms" integer,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "spotify_mirrors" (
	"key" text PRIMARY KEY NOT NULL,
	"playlist_id" text NOT NULL,
	"url" text NOT NULL,
	"snapshot_id" text,
	"synced_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "statsfm_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"statsfm_id" text NOT NULL,
	"custom_id" text,
	"display_name" text NOT NULL,
	"image_url" text,
	"is_plus" boolean DEFAULT false NOT NULL,
	"privacy" text DEFAULT '{}' NOT NULL,
	"show_live" boolean DEFAULT true NOT NULL,
	"show_plays" boolean DEFAULT true NOT NULL,
	"lifetime_streams" integer,
	"lifetime_ms" bigint,
	"unique_tracks" integer,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listen_syncs" ADD CONSTRAINT "listen_syncs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_tops" ADD CONSTRAINT "listen_tops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_tops" ADD CONSTRAINT "listen_tops_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_ballots" ADD CONSTRAINT "monthly_ballots_round_id_monthly_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."monthly_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_ballots" ADD CONSTRAINT "monthly_ballots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_ballots" ADD CONSTRAINT "monthly_ballots_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_pool" ADD CONSTRAINT "monthly_pool_round_id_monthly_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."monthly_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_pool" ADD CONSTRAINT "monthly_pool_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_pool" ADD CONSTRAINT "monthly_pool_nominated_by_users_id_fk" FOREIGN KEY ("nominated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_results" ADD CONSTRAINT "monthly_results_round_id_monthly_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."monthly_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_results" ADD CONSTRAINT "monthly_results_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_rounds" ADD CONSTRAINT "monthly_rounds_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "now_playing" ADD CONSTRAINT "now_playing_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "now_playing" ADD CONSTRAINT "now_playing_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsfm_accounts" ADD CONSTRAINT "statsfm_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_tops_rank_idx" ON "listen_tops" USING btree ("user_id","period","position");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_rounds_crew_month_idx" ON "monthly_rounds" USING btree ("crew_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "statsfm_accounts_statsfm_id_idx" ON "statsfm_accounts" USING btree ("statsfm_id");