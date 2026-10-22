-- The same message synced once as HTML (dedupe key from the message id) and once as text (key from a content hash)
-- was stored twice. Removes the rows without message id (from text) that have a copy with the same content: one with
-- a message id, or an older one without. Rows with message ids stay, also with the same content (two expeditions
-- with the same result in the same second).

DELETE FROM battle_reports AS d WHERE d.msg_id IS NULL AND EXISTS (
  SELECT 1 FROM battle_reports k WHERE k.group_id = d.group_id AND k.id <> d.id AND (k.msg_id IS NOT NULL OR k.id < d.id)
    AND k.user_id IS d.user_id AND k.time IS d.time AND k.g = d.g AND k.s = d.s AND k.p = d.p AND k.planet_type = d.planet_type
    AND k.lost_attacker = d.lost_attacker AND k.lost_defender = d.lost_defender AND k.loot_metal = d.loot_metal
    AND k.loot_crystal = d.loot_crystal AND k.loot_deuterium = d.loot_deuterium
    AND k.debris_metal = d.debris_metal AND k.debris_crystal = d.debris_crystal);

-- manually counted expeditions are never copies
DELETE FROM expeditions AS d WHERE d.msg_id IS NULL AND d.dedupe_key NOT LIKE 'manual:%' AND EXISTS (
  SELECT 1 FROM expeditions k WHERE k.group_id = d.group_id AND k.id <> d.id AND (k.msg_id IS NOT NULL OR k.id < d.id)
    AND k.dedupe_key NOT LIKE 'manual:%' AND k.user_id = d.user_id AND k.time IS d.time AND k.g IS d.g AND k.s IS d.s
    AND k.p IS d.p AND k.event = d.event AND k.size = d.size AND k.factor IS d.factor
    AND k.found_resources = d.found_resources AND k.found_ships = d.found_ships);

DELETE FROM hostile_spying AS d WHERE d.msg_id IS NULL AND EXISTS (
  SELECT 1 FROM hostile_spying k WHERE k.group_id = d.group_id AND k.id <> d.id AND (k.msg_id IS NOT NULL OR k.id < d.id)
    AND k.time IS d.time AND k.from_player = d.from_player AND k.from_g = d.from_g AND k.from_s = d.from_s
    AND k.from_p = d.from_p AND k.target_g = d.target_g AND k.target_s = d.target_s AND k.target_p = d.target_p);

-- recycling, including the debris entry of the activity log written for the copy
CREATE TEMP TABLE dup AS SELECT d.id, d.group_id, d.dedupe_key FROM recycle_reports d WHERE d.msg_id IS NULL AND EXISTS (
  SELECT 1 FROM recycle_reports k WHERE k.group_id = d.group_id AND k.id <> d.id AND (k.msg_id IS NOT NULL OR k.id < d.id)
    AND k.user_id IS d.user_id AND k.time IS d.time AND k.g = d.g AND k.s = d.s AND k.p = d.p
    AND k.metal = d.metal AND k.crystal = d.crystal AND k.total_metal = d.total_metal AND k.total_crystal = d.total_crystal);
DELETE FROM activity_log WHERE (group_id, dedupe_key) IN (SELECT group_id, 'recycle:' || dedupe_key FROM dup);
DELETE FROM recycle_reports WHERE id IN (SELECT id FROM dup);
DROP TABLE dup;
