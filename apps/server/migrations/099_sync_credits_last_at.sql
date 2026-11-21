-- The recap's number of syncs (sync_credits kind 'sync') follows a rule per page type (repo/syncCount.ts):
-- `last_at` is when a page type last counted (the own state pages count at most every 15 minutes or every hour;
-- null on other kinds and old rows), `fingerprint` what the group's last view of a galaxy system showed (a galaxy
-- page counts only when a system changed).
ALTER TABLE sync_credits ADD COLUMN last_at INTEGER;
ALTER TABLE galaxy_views ADD COLUMN fingerprint TEXT;
