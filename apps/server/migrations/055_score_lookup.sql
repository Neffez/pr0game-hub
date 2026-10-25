-- The newest score of a player (per category, before a time) was found by aggregating the player's whole history,
-- which grows with every statistics update (seconds for the overview and statistics pages after a few months).
-- Category and stat time are copied onto the score rows so an index finds it directly.
ALTER TABLE player_scores ADD COLUMN type INTEGER;
ALTER TABLE player_scores ADD COLUMN stat_time INTEGER;
UPDATE player_scores SET (type, stat_time) = (SELECT type, stat_time FROM stat_snapshots WHERE id = snapshot_id);
DROP INDEX player_scores_player;
CREATE INDEX player_scores_history ON player_scores (player_id, type, stat_time);
-- rows inserted without them (the snapshot's values never change)
CREATE TRIGGER player_scores_lookup AFTER INSERT ON player_scores WHEN NEW.stat_time IS NULL BEGIN
  UPDATE player_scores SET (type, stat_time) = (SELECT type, stat_time FROM stat_snapshots WHERE id = NEW.snapshot_id)
  WHERE rowid = NEW.rowid;
END;
