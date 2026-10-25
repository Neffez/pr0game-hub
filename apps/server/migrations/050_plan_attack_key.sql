-- Plans made from an own attack in flight remember its key (route and lead ships), so fleets joining the ACS later
-- and a moved arrival can be carried over into the plan.
ALTER TABLE attack_plans ADD COLUMN attack_key TEXT;
