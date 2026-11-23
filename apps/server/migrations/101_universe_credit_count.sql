-- A universe.json now earns one ranking point per percent of the universe's systems it refreshed, up to 100 a week
-- (repo/achievements.ts `POINTS.universe` 1, `WEEKLY`): the credits stored before were worth 100 points each.
UPDATE sync_credits SET count = 100 WHERE kind = 'universe';
