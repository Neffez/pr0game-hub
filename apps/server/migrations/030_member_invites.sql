-- Claim invite: which placeholder user (users.id) the invite activates; NULL = normal group invite.
ALTER TABLE invites ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
