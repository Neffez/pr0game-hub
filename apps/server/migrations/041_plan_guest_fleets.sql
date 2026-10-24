-- Fleets of non-members in an ACS taken over from an overview into a plan (they have no hub account): only for the
-- combat simulators. JSON [{"player": {"id": 1, "name": "x"} | null, "from": {"g", "s", "p", "type"}, "mission": 2,
-- "ships": {"207": 5}}], NULL for plans without them.
ALTER TABLE attack_plans ADD COLUMN guests TEXT;
