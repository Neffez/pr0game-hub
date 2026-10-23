-- Hold plans and phalanx results. A plan either attacks a target ('attack': solo, ACS, retime) or holds on a member's
-- planet against a hostile attack ('hold': every fleet lands on its own, `hold_offset` seconds from the impact; holds
-- cannot be delayed). A pasted phalanx result gives the enemy fleet's landing back home directly.
ALTER TABLE attack_plans ADD COLUMN mission TEXT NOT NULL DEFAULT 'attack' CHECK (mission IN ('attack', 'hold'));
-- hold: seconds from the enemy's impact the hold fleets land (default 1 s before it)
ALTER TABLE attack_plan_enemy ADD COLUMN hold_offset INTEGER NOT NULL DEFAULT -1;
-- retime: landing of the followed fleet back home as a phalanx showed it, and when it was pasted
ALTER TABLE attack_plan_enemy ADD COLUMN phalanx_home INTEGER;
ALTER TABLE attack_plan_enemy ADD COLUMN phalanx_time INTEGER;
