-- Fight statistics from synced player cards (optional for members): the two unit blocks of the card, "involved"
-- (the whole side of every fight) and "real" (the player's own fleets), in metal + crystal value, plus wins, draws
-- and losses. A row per change, so the rank badge can read the card as of a past day (repo/rank.ts: the newest card
-- before then, plus the battle reports after it).
CREATE TABLE player_combat_stats (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seen_at INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  destroyed INTEGER NOT NULL,
  lost INTEGER NOT NULL,
  debris_metal INTEGER NOT NULL,
  debris_crystal INTEGER NOT NULL,
  real_destroyed INTEGER NOT NULL,
  real_lost INTEGER NOT NULL,
  real_debris_metal INTEGER NOT NULL,
  real_debris_crystal INTEGER NOT NULL,
  PRIMARY KEY (group_id, player_id, seen_at)
) WITHOUT ROWID;
