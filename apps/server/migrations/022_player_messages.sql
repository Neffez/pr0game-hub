-- Whether a user shares their synced player messages with the other members (0 = only they see them).
ALTER TABLE users ADD COLUMN message_share INTEGER NOT NULL DEFAULT 0;
-- Player messages ("Spieler Nachrichten") as synced by a member. Sender and recipient keep a copy each in the game
-- (different message ids), so `dedupe_key` is built from the content and the list shows each message once.
CREATE TABLE player_messages (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- private data: gone with the account
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  msg_id INTEGER,
  time INTEGER NOT NULL,
  from_name TEXT NOT NULL,
  -- "g:s:p" of the sender's main planet when shown
  from_coords TEXT,
  -- [{"name": …, "coords": "g:s:p" | null}]
  recipients TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id, dedupe_key)
);
CREATE INDEX player_messages_time ON player_messages (group_id, time);
