-- Indexes for queries that read a whole table or a group's whole history to keep a few rows:
-- spy reports of a group by time (farm finder, recent reports, the paged report list, sync credits) sorted all the
-- group's reports with their sections; the hourly housekeeping deleted old pasted pages and player activity with a
-- full table scan.
CREATE INDEX spy_reports_time ON spy_reports (group_id, report_time);
CREATE INDEX raw_ingests_created ON raw_ingests (created_at);
CREATE INDEX player_activity_time ON player_activity (time);

-- Statistics for the new indexes right away (sampled, cheap): without them the planner takes the time index for
-- lookups by coordinates too (the galaxy view) until the hourly `PRAGMA optimize` analyzes the table.
PRAGMA analysis_limit = 1000;
ANALYZE spy_reports;
ANALYZE raw_ingests;
ANALYZE player_activity;
PRAGMA analysis_limit = 0;
