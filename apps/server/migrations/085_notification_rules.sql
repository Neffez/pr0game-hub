-- Notification rules (G-4). Quiet hours per push device: JSON { from, to, tz, except } (notify.ts), NULL: none. The
-- quiet hours of a user's Discord webhook live in `users.discord_prefs`.
ALTER TABLE push_subscriptions ADD COLUMN quiet TEXT;

-- Notifications held back by quiet hours, sent when they end: `target` is `p:<push subscription id>` or
-- `u:<user id>` (the user's Discord webhook). A newer notification with the same tag replaces the older one; what
-- expired meanwhile (an attack that landed) is dropped.
CREATE TABLE notify_held (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL,
  tag TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  held_at INTEGER NOT NULL,
  UNIQUE (target, tag)
);

-- Planets whose full storages a member does not want to hear about by push or Discord (the bell still lists them).
CREATE TABLE storage_muted (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, g, s, p)
);
