-- Plan fleets withdrawn because the member's overview showed them recalled (page time of that overview).
ALTER TABLE attack_plan_fleets ADD COLUMN recalled_at INTEGER;
