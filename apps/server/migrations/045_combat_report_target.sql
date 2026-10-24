-- Attacked planet or moon of a battle report (first defender), NULL when the page hid the coordinates. Reports pasted
-- as text have no report id: they take the id of the battle message at the same target and time, else a local id
-- "text-<epoch>-<g>-<s>-<p>".
ALTER TABLE combat_reports ADD COLUMN g INTEGER;
ALTER TABLE combat_reports ADD COLUMN s INTEGER;
ALTER TABLE combat_reports ADD COLUMN p INTEGER;
ALTER TABLE combat_reports ADD COLUMN planet_type TEXT;
CREATE INDEX combat_reports_target ON combat_reports (group_id, g, s, p, time);
