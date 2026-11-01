-- A scheduled universe: active from this time (epoch); null = active since its creation.
-- `ended_at` may now also lie in the future: the universe ends (is frozen) then.
ALTER TABLE universes ADD COLUMN starts_at INTEGER;
