-- Resources the attackers of a battle report captured together (0 for reports archived before).
ALTER TABLE combat_reports ADD COLUMN loot_metal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE combat_reports ADD COLUMN loot_crystal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE combat_reports ADD COLUMN loot_deuterium INTEGER NOT NULL DEFAULT 0;

-- ACS loot settlement of a raid plan, shared with the group: the input of @pr0hub/loot (LootState JSON) as last saved,
-- the result is computed from it. Participants and helpers that are members have the id "u<user id>".
CREATE TABLE raid_settlements (
  plan_id INTEGER PRIMARY KEY REFERENCES attack_plans(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  -- deliveries marked as done: JSON ["<from id>><to id>", …]
  done TEXT NOT NULL DEFAULT '[]',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
