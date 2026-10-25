-- When 0, other members do not see which page the member is on; global admins still see it.
ALTER TABLE users ADD COLUMN share_activity INTEGER NOT NULL DEFAULT 1;
