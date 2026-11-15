-- 086 rebuilt stat_snapshots from a copy of 008 and brought back the index 010 dropped: same columns as the UNIQUE
-- constraint, which SQLite already backs with an index (N-02 of the 2026-11-15 review).
DROP INDEX IF EXISTS stat_snapshots_time;
