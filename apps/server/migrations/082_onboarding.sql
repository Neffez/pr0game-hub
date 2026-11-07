-- Onboarding of new members (backlog D-4): when a member first synced each kind of page (statistics, empire,
-- overview, research, galaxy, messages, buildings). Written by the ingest; existing members get the steps their
-- stored pages show (raw pages only for statistics and galaxy views, which keep no user otherwise).
CREATE TABLE onboarding_steps (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  time INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id, step)
) WITHOUT ROWID;

INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'empire', MIN(created_at) FROM empire_snapshots GROUP BY group_id, user_id;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'overview', MIN(t) FROM (
    SELECT group_id, user_id, page_time AS t FROM overview_snapshots UNION ALL SELECT group_id, user_id, page_time FROM fleet_snapshots
  ) WHERE user_id IS NOT NULL GROUP BY group_id, user_id;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'research', MIN(page_time) FROM research_snapshots WHERE user_id IS NOT NULL GROUP BY group_id, user_id;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'buildings', MIN(page_time) FROM building_snapshots WHERE user_id IS NOT NULL GROUP BY group_id, user_id;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'messages', MIN(created_at) FROM spy_reports WHERE user_id IS NOT NULL GROUP BY group_id, user_id;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, COALESCE(synced_by, user_id), CASE page_type WHEN 'stats' THEN 'stats' WHEN 'galaxy' THEN 'galaxy' ELSE 'messages' END, MIN(created_at)
  FROM raw_ingests WHERE page_type IN ('stats', 'galaxy', 'messages') AND COALESCE(synced_by, user_id) IS NOT NULL
  GROUP BY group_id, COALESCE(synced_by, user_id), page_type;
INSERT OR IGNORE INTO onboarding_steps (group_id, user_id, step, time)
  SELECT group_id, user_id, 'galaxy', MIN(seen_at) FROM galaxy_views WHERE user_id IS NOT NULL GROUP BY group_id, user_id;
