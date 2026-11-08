-- Offline window presets of the fleet save planner (A-2), per user and for all devices:
-- [{"name":"Night","from":"23:30","to":"07:15"},...]; NULL until the user changes them (the web app shows its built-ins)
ALTER TABLE users ADD COLUMN fleetsave_presets TEXT;
