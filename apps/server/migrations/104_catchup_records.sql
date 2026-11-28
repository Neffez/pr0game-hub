-- Record levels of the universe as far as they matter for the catch-up bonus (the game's getCatchUpFactorForElement
-- gives less of it near the record of a building or research): from the records page (exact) and from the costs of
-- buildings and research pages (exact, at most or at least). min_level/max_level: the bounds known, null when none.
CREATE TABLE catchup_records (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  element_id INTEGER NOT NULL,
  min_level INTEGER,
  max_level INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, element_id)
);
