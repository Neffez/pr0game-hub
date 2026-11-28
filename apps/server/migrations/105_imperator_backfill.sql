-- The imperator badge (sync_credits kind 'empire') missed the days of members who synced their empire every few
-- minutes: an empire only counted an hour after the one stored last, which such syncs never left. The recap's sync
-- count (kind 'sync', key 'empire') measured the hour from the empire that counted last and holds those days: each
-- of them is credited back.
INSERT OR IGNORE INTO sync_credits (group_id, user_id, day, kind, key, count)
SELECT DISTINCT group_id, user_id, day, 'empire', '', 1 FROM sync_credits WHERE kind = 'sync' AND key = 'empire';
