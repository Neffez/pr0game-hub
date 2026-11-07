-- Moon chance of a battle from its report (backlog B-6): the chance in percent, the extra of the cascading moon chance
-- and whether the battle created a moon. NULL for reports stored before (and moon destructions).
ALTER TABLE combat_reports ADD COLUMN moon_chance INTEGER;
ALTER TABLE combat_reports ADD COLUMN moon_extra INTEGER NOT NULL DEFAULT 0;
ALTER TABLE combat_reports ADD COLUMN moon_created INTEGER NOT NULL DEFAULT 0;
CREATE INDEX combat_reports_moon ON combat_reports (group_id, time) WHERE moon_chance > 0 OR moon_created = 1;
