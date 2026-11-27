CREATE TABLE "memberships" (
	"user_id" text NOT NULL,
	"crew_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_crew_id_pk" PRIMARY KEY("user_id","crew_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_crew_idx" ON "memberships" USING btree ("crew_id");--> statement-breakpoint
-- everyone already in a group becomes a member of it; admins stay admins
INSERT INTO "memberships" ("user_id", "crew_id", "role", "joined_at")
SELECT "id", "crew_id", CASE WHEN "is_admin" THEN 'admin' ELSE 'member' END, "created_at" FROM "users"
ON CONFLICT DO NOTHING;
