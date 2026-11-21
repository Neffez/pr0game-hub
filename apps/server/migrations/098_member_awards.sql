-- Badges that global admins award by hand (`livingLegend`: "Living legend") to a member of a group. Read by the
-- achievements next to the counted badges (repo/achievements.ts); `awarded_at` dates the badge for the recap.
CREATE TABLE member_awards (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, key)
);
