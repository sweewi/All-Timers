CREATE TABLE "list_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"set_at" timestamp with time zone,
	"rules" text,
	"playlist_id" text,
	"playlist_seen" text,
	"playlist_checked_at" timestamp with time zone,
	"share_token" text,
	"card" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_profiles_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "list_profiles" ADD CONSTRAINT "list_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;