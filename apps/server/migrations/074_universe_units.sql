-- Ships, defense and missiles of a universe: its differences from the hub's defaults (@pr0hub/core/units).
ALTER TABLE universes ADD COLUMN units TEXT NOT NULL DEFAULT '{}';
