-- Requests for access from people without an account (login page): the requested username and password (hashed)
-- wait here until a global admin assigns them to a placeholder member, which then takes over both.
CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'de',
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
