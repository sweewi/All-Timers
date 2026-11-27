-- Rankings from stats.fm are now ordered by play count instead of minutes listened.
-- Forget when each cached list was fetched so every list is refetched (and re-ranked) on next use.
DELETE FROM "listen_syncs";
