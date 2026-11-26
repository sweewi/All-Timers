CREATE TABLE "reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_target_kind_idx" ON "reactions" USING btree ("user_id","target","kind");--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target");