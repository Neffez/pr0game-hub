-- Player cards earn a ranking point (repo/achievements.ts `POINTS.playerCard`): a card that brought something new,
-- once a day per player and member. Of the cards before, the recap's sync counts hold the first new card of each
-- player per member (kind 'sync', key 'playerCard:<player>'): those are credited back to their days.
INSERT OR IGNORE INTO sync_credits (group_id, user_id, day, kind, key, count)
SELECT group_id, user_id, day, 'playerCard', substr(key, 12), 1 FROM sync_credits WHERE kind = 'sync' AND key LIKE 'playerCard:%';
