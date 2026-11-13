-- Hub display name (Discord identity), independent of login username and in-game name.
ALTER TABLE users ADD COLUMN display_name TEXT;
