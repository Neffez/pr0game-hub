-- Same columns as the tables' UNIQUE constraints, which SQLite already backs with an index
DROP INDEX IF EXISTS spy_reports_coords;
DROP INDEX IF EXISTS stat_snapshots_time;
