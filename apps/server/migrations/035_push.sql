-- Web push: subscriptions per browser/device of a user, what was already pushed (sent once), the server's VAPID
-- key pair (created on the first start) and which notifications a user wants pushed.
CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_ok_at INTEGER
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- notification ids (repo/notifications.ts) pushed to a user; kept a week
CREATE TABLE push_sent (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);

-- JSON, missing keys take the defaults of push.ts
ALTER TABLE users ADD COLUMN push_prefs TEXT;
