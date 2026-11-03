-- What an interplanetary missile impact did: `result` hit / intercepted / noDefense (NULL: not in the synced text),
-- the missiles intercepted by anti-ballistic missiles and the destroyed units as JSON {id: count}.
ALTER TABLE missile_impacts ADD COLUMN result TEXT CHECK (result IN ('hit', 'intercepted', 'noDefense'));
ALTER TABLE missile_impacts ADD COLUMN intercepted INTEGER;
ALTER TABLE missile_impacts ADD COLUMN losses TEXT;
CREATE INDEX missile_impacts_time ON missile_impacts (group_id, time);
