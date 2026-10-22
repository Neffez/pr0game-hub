-- "no_game_url" was the crawler's status before universes without game URL were skipped; such reports are pending.
UPDATE battle_hall SET report_status = NULL WHERE report_status = 'no_game_url';
-- reports archived from a paste before the status existed
UPDATE battle_hall SET report_status = 'archived' WHERE report_status IS NULL
  AND EXISTS (SELECT 1 FROM combat_reports c WHERE c.group_id = battle_hall.group_id AND c.report_id = battle_hall.report_id);
-- the crawler looks for the newest pending report every few seconds (3 = crawler MAX_TRIES)
CREATE INDEX battle_hall_pending ON battle_hall (time) WHERE report_status IS NULL AND report_tries < 3;
