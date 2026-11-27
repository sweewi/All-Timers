ALTER TABLE "statsfm_accounts" ADD COLUMN "syncing" boolean;--> statement-breakpoint
ALTER TABLE "statsfm_accounts" ADD COLUMN "imported" boolean;--> statement-breakpoint
ALTER TABLE "statsfm_accounts" ADD COLUMN "recent_streams" integer;--> statement-breakpoint
ALTER TABLE "statsfm_accounts" ADD COLUMN "recent_tracks" integer;