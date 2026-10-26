-- When 0, the member's syncs reach the other members without the member's id: their views reload, but no hint names
-- who synced.
ALTER TABLE users ADD COLUMN share_syncs INTEGER NOT NULL DEFAULT 1;
