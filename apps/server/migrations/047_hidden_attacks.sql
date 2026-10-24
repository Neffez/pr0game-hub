-- Hostile attacks hidden by hand in the raid planner, for the whole group. The attack key (route and lead ships) can
-- come back with a later attack of the same fleet: a hide only covers attacks arriving before `until`, the latest
-- possible return of the hidden one.
CREATE TABLE hidden_attacks (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  attack_key TEXT NOT NULL,
  until INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (group_id, attack_key)
);
