-- Farewell battles ("Abschiede"): a player crashing into a fleet on purpose when quitting, flagged by the game team.
-- The hall rows don't show the flag; it follows from the page's filter: 1 seen with "only farewells", 0 seen with
-- "hide farewells", NULL not known yet (only seen with "all" or a page without the filter).
ALTER TABLE battle_hall ADD COLUMN memorial INTEGER;
