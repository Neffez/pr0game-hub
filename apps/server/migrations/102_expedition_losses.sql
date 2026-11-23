-- Expedition losses: `lost_units` the units the fleet lost in a fight with pirates or aliens (battle summary of the
-- report; NULL for rows synced before), `lost_ships` the ships of a fleet a black hole swallowed (JSON, from the synced
-- fleet list or entered by hand), `lost_source` where those ships come from ('fleet' or 'manual').
ALTER TABLE expeditions ADD COLUMN lost_units INTEGER;
ALTER TABLE expeditions ADD COLUMN lost_ships TEXT;
ALTER TABLE expeditions ADD COLUMN lost_source TEXT;
