-- Sync credits (badges, streaks, the weekly ranking): what a member's syncs brought per day in the universe's time
-- zone. `key` makes a unit count once (a galaxy system per day, a planet's page per day, '' for once-a-day kinds);
-- `count` adds up kinds counted in bulk. Points are worked out from the kinds when read (see repo/achievements.ts).
CREATE TABLE sync_credits (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (group_id, user_id, day, kind, key)
);
CREATE INDEX sync_credits_group_day ON sync_credits (group_id, day);
