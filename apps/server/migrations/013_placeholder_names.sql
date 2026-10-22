-- Players only known by id got the placeholder name "Spieler #<id>" (universe.json without names). The sync stored
-- it as a former name once the real name came, or kept it as the current name when the real name came from older
-- data. Placeholders are never former names, and the newest real name replaces a current placeholder.
DELETE FROM player_aliases WHERE name = (SELECT 'Spieler #' || p.ingame_id FROM players p WHERE p.id = player_aliases.player_id);
CREATE TEMP TABLE renamed AS
  SELECT p.id, (SELECT a.name FROM player_aliases a WHERE a.player_id = p.id ORDER BY a.seen_until DESC LIMIT 1) AS name
  FROM players p WHERE p.name = 'Spieler #' || p.ingame_id AND EXISTS (SELECT 1 FROM player_aliases a WHERE a.player_id = p.id);
UPDATE players SET name = (SELECT name FROM renamed r WHERE r.id = players.id) WHERE id IN (SELECT id FROM renamed);
DELETE FROM player_aliases WHERE (player_id, name) IN (SELECT id, name FROM renamed);
DROP TABLE renamed;
