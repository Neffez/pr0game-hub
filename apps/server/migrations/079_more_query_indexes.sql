-- Players of an alliance (alliance search counts them; deleting an alliance sets them to NULL)
CREATE INDEX players_alliance ON players (alliance_id);
-- Rows of one player (merging and deleting players, taking a sync back)
CREATE INDEX activity_log_player ON activity_log (player_id);
CREATE INDEX attack_plans_player ON attack_plans (player_id);
-- Launch reminders look at the plans of all groups by their target time
CREATE INDEX attack_plans_target_time ON attack_plans (target_time);
-- Sent notifications are cleaned up by their age
CREATE INDEX push_sent_time ON push_sent (sent_at);
CREATE INDEX discord_sent_time ON discord_sent (sent_at);
-- Finished loot settlements of a group
CREATE INDEX raid_settlements_group ON raid_settlements (group_id, finalized_at);
