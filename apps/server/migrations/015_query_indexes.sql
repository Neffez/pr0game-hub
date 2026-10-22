-- Raids, recycling and expeditions are filtered and sorted by their game time, falling back to the sync time
CREATE INDEX battle_reports_when ON battle_reports (group_id, COALESCE(time, created_at));
CREATE INDEX recycle_reports_when ON recycle_reports (group_id, COALESCE(time, created_at));
CREATE INDEX expeditions_when ON expeditions (group_id, COALESCE(time, created_at));
-- spy reports of a player are also found by the name in the report (case-insensitive like player names)
CREATE INDEX spy_reports_player_name ON spy_reports (group_id, player_name COLLATE NOCASE);
