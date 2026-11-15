-- "Who threatens me" (repo/threats.ts) reads a group's combat reports by time; the (group_id, time) index of 083 is
-- partial (moon chances only), so it scanned all of them (N-T2 of the 2026-11-15 review).
CREATE INDEX combat_reports_time ON combat_reports (group_id, time);
