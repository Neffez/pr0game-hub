-- Hold plans: ships on the attacked planet for the combat simulators, changed by hand (JSON element id -> amount, e.g.
-- ships sent away before the impact); NULL takes them from the member's empire page or the planet's spy report.
ALTER TABLE attack_plan_enemy ADD COLUMN planet_ships TEXT;
