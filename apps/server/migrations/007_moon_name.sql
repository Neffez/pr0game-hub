-- Name of the moon at a position (galaxy view HTML, moon spy reports, members' empire pages).
ALTER TABLE planets ADD COLUMN moon_name TEXT;

UPDATE planets SET moon_name = (
  SELECT sr.planet_name FROM spy_reports sr
  WHERE sr.group_id = planets.group_id AND sr.g = planets.g AND sr.s = planets.s AND sr.p = planets.p
    AND sr.planet_type = 'moon' AND sr.planet_name IS NOT NULL
  ORDER BY sr.report_time DESC LIMIT 1
) WHERE has_moon = 1;
