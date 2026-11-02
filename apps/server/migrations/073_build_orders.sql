-- Build order of a member (imported from pr0plan): per planet an ordered list of steps and the levels it starts from
-- (`data`, JSON of @pr0hub/planner's BuildOrder), and where it came from (`meta`: the file's settings, the planet
-- mapping, left out actions). One per member and group; the next step of each planet notifies once it can start.
CREATE TABLE build_orders (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (group_id, user_id)
);
