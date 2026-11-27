CREATE TABLE "ratings" (
	"user_id" text NOT NULL,
	"track_id" text NOT NULL,
	"bucket" text NOT NULL,
	"ord" double precision NOT NULL,
	"score" real NOT NULL,
	"note" text,
	"comparisons" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_user_id_track_id_pk" PRIMARY KEY("user_id","track_id")
);
--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ratings_user_bucket_ord_idx" ON "ratings" USING btree ("user_id","bucket","ord");--> statement-breakpoint
CREATE INDEX "ratings_track_idx" ON "ratings" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "ratings_created_idx" ON "ratings" USING btree ("created_at");