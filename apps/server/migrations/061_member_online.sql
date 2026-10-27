-- When members had the hub open and active (5-minute slots), for the activity pattern of their players. Shown to the
-- other members only when the member shows their online status (`users.show_online`); kept 30 days.
CREATE TABLE member_online (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, slot)
) WITHOUT ROWID;
CREATE INDEX member_online_slot ON member_online (slot);
