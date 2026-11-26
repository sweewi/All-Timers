CREATE TABLE "crews" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crews_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "list_entries" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"track_id" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_entries_user_id_kind_track_id_pk" PRIMARY KEY("user_id","kind","track_id")
);
--> statement-breakpoint
CREATE TABLE "login_links" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "origins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"from_user_id" text,
	"from_name" text,
	"when_text" text,
	"where_text" text,
	"story" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_events" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"track_id" text NOT NULL,
	"type" text NOT NULL,
	"from_pos" integer,
	"to_pos" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"artists" text DEFAULT '[]' NOT NULL,
	"album" text DEFAULT '' NOT NULL,
	"image_url" text,
	"release_year" integer,
	"duration_ms" integer,
	"isrc" text,
	"song_key" text NOT NULL,
	"meta_source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"crew_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"color" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_links" ADD CONSTRAINT "login_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origins" ADD CONSTRAINT "origins_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_events" ADD CONSTRAINT "rank_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_events" ADD CONSTRAINT "rank_events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_track_idx" ON "list_entries" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "origins_user_track_idx" ON "origins" USING btree ("user_id","track_id");--> statement-breakpoint
CREATE INDEX "origins_from_user_idx" ON "origins" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "rank_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "rank_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "tracks" USING btree ("isrc");--> statement-breakpoint
CREATE INDEX "tracks_song_key_idx" ON "tracks" USING btree ("song_key");--> statement-breakpoint
CREATE INDEX "users_crew_idx" ON "users" USING btree ("crew_id");