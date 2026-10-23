-- Per message choice of the member who synced it: 1 shared, 0 not shared, NULL = their account setting.
ALTER TABLE player_messages ADD COLUMN share INTEGER;
