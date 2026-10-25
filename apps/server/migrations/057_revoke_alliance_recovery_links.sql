-- Only global admins may create password recovery links (links for accounts that already have a password).
-- Open ones created by alliance admins are withdrawn.
DELETE FROM invites
WHERE used_at IS NULL
  AND user_id IN (SELECT id FROM users WHERE password_hash <> '')
  AND (created_by IS NULL OR created_by NOT IN (SELECT id FROM users WHERE is_admin = 1));
