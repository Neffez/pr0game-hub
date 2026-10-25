-- Battle simulation taken over into an attack plan: the target's ships, defense and combat research, and the combat
-- research of guest fleets (JSON, see repo/simPlan.ts).
ALTER TABLE attack_plans ADD COLUMN sim TEXT;
