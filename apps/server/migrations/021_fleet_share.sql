-- Which fleet movements a user shares with the other members: {"enabled": bool, "hidden": [mission ids]}; NULL = all.
ALTER TABLE users ADD COLUMN fleet_share TEXT;
