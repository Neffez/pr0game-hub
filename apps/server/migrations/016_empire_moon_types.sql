-- Empire pages stored before moon detection have planets without a type; the server fixed them on every read.
-- A moon shares the coordinates of the planet listed before it and has a moon base (41).
UPDATE empire_snapshots SET data = json_set(data, '$.planets', (
  SELECT json_group_array(json(CASE
      WHEN json_extract(p.value, '$.type') IS NOT NULL THEN p.value
      ELSE json_set(p.value, '$.type', CASE
        WHEN COALESCE(json_extract(p.value, '$.values."41"'), 0) > 0
          OR EXISTS (SELECT 1 FROM json_each(empire_snapshots.data, '$.planets') q
                     WHERE q.key < p.key AND json_extract(q.value, '$.coords') = json_extract(p.value, '$.coords'))
        THEN 'moon' ELSE 'planet' END)
    END) ORDER BY p.key)
  FROM json_each(empire_snapshots.data, '$.planets') p))
WHERE EXISTS (SELECT 1 FROM json_each(data, '$.planets') x WHERE json_extract(x.value, '$.type') IS NULL);
