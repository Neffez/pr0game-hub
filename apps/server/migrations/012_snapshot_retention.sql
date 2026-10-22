-- Older game overview pages are never read (only the newest per member), empire pages only within the last week
-- (live fleet in the imperium). The sync keeps it that way from now on.
DELETE FROM overview_snapshots WHERE id NOT IN (
  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id, user_id ORDER BY page_time DESC, id DESC) AS n FROM overview_snapshots)
  WHERE n = 1);
DELETE FROM empire_snapshots WHERE created_at < unixepoch() - 7 * 86400 AND id NOT IN (
  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id, user_id ORDER BY created_at DESC, id DESC) AS n FROM empire_snapshots)
  WHERE n = 1);
