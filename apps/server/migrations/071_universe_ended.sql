-- A universe that is over: frozen at this time (data stays readable, nothing is written or extrapolated past it).
ALTER TABLE universes ADD COLUMN ended_at INTEGER;
