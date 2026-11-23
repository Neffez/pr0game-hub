-- Player cards earn a ranking point (repo/achievements.ts `POINTS.playerCard`): the first card of a player that
-- brought something new, per member. The recap's sync counts hold exactly those cards (kind 'sync', key
-- 'playerCard:<player>', once per player and member), so the points are credited back to their days.
INSERT OR IGNORE INTO sync_credits (group_id, user_id, day, kind, key, count)
SELECT group_id, user_id, day, 'playerCard', substr(key, 12), 1 FROM sync_credits WHERE kind = 'sync' AND key LIKE 'playerCard:%';
