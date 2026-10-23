-- Drive levels of a plan fleet entered by hand (JSON research id -> level for 115, 117, 118; NULL = from the member's
-- empire page or spy reports) and when; the newest of these sources counts.
ALTER TABLE attack_plan_fleets ADD COLUMN drives TEXT;
ALTER TABLE attack_plan_fleets ADD COLUMN drives_time INTEGER;
-- Who invited the member (every member may invite); NULL for own fleets and older invitations (= the plan's creator).
ALTER TABLE attack_plan_fleets ADD COLUMN invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
