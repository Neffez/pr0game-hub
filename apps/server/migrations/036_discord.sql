-- Discord: a personal webhook per user (the bell's notifications, settings like push), a channel webhook per group
-- (attacks on members, new plans, launch reminders) and the user's Discord id to be mentioned in that channel.
ALTER TABLE users ADD COLUMN discord_webhook TEXT;
-- JSON, missing keys take the defaults of push.ts
ALTER TABLE users ADD COLUMN discord_prefs TEXT;
ALTER TABLE users ADD COLUMN discord_user_id TEXT;
ALTER TABLE groups ADD COLUMN discord_webhook TEXT;
-- JSON, missing keys take the defaults of discord.ts
ALTER TABLE groups ADD COLUMN discord_prefs TEXT;

-- notification ids sent to a webhook (`u:<user id>` or `g:<group id>`); kept a week
CREATE TABLE discord_sent (
  target TEXT NOT NULL,
  key TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (target, key)
);
