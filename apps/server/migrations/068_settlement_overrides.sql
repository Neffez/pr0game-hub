-- Loot settlements follow the hub's data: `overrides` holds only the corrections made by hand on top of the draft
-- computed from the synced reports (JSON, `Overrides` of @pr0hub/loot); `data` is the state frozen when the
-- settlement was finalized (and, while it is open, the state when it was last saved). Settlements saved before count
-- as finalized with their saved state; reopening one turns it into corrections (NULL `overrides`).
ALTER TABLE raid_settlements ADD COLUMN overrides TEXT;
ALTER TABLE raid_settlements ADD COLUMN finalized_at INTEGER;
ALTER TABLE raid_settlements ADD COLUMN finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
UPDATE raid_settlements SET finalized_at = updated_at, finalized_by = updated_by;
