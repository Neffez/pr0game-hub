-- Universe the start page /hub/ forwards to (at most one; none = show the universe list).
ALTER TABLE universes ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
