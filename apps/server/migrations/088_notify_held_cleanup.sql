-- Held notifications belong to their target, not to whoever gets its id next (N-01 of the 2026-11-15 review).
-- `notify_held.target` is `p:<push subscription id>` or `u:<user id>` without a foreign key (Discord and push share
-- the table), so these triggers drop the held rows when the subscription or the user goes away, and when a browser
-- moves to another user (the subscribe upsert). Delete triggers also fire for ON DELETE CASCADE.
-- A rebuild of push_subscriptions or users must recreate them.
DELETE FROM notify_held WHERE target LIKE 'p:%' AND CAST(substr(target, 3) AS INTEGER) NOT IN (SELECT id FROM push_subscriptions);
DELETE FROM notify_held WHERE target LIKE 'u:%' AND CAST(substr(target, 3) AS INTEGER) NOT IN (SELECT id FROM users);

CREATE TRIGGER push_subscriptions_held_delete AFTER DELETE ON push_subscriptions
BEGIN
  DELETE FROM notify_held WHERE target = 'p:' || OLD.id;
END;

CREATE TRIGGER push_subscriptions_held_owner AFTER UPDATE OF user_id ON push_subscriptions
WHEN OLD.user_id IS NOT NEW.user_id
BEGIN
  DELETE FROM notify_held WHERE target = 'p:' || OLD.id;
END;

CREATE TRIGGER users_held_delete AFTER DELETE ON users
BEGIN
  DELETE FROM notify_held WHERE target = 'u:' || OLD.id;
END;
