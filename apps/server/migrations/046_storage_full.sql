-- Storages of the members' planets that are full by the newest synced pages (repo/notifications.ts), with since when:
-- the notification keeps its id while the storage stays full over newer syncs. Removed once it is no longer full.
CREATE TABLE storage_full (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  p INTEGER NOT NULL,
  -- 901 metal, 902 crystal, 903 deuterium
  resource INTEGER NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, g, s, p, resource)
);
