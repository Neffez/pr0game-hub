-- When 0, the member appears offline to others; global admins still see the real presence.
ALTER TABLE users ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1;
