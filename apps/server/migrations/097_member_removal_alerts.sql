-- A member removed from a group kept their building alerts, fleet alerts and full-storage state there: their foreign
-- keys cascade only on group or user deletion. The notification scheduler then planned for a user who is no longer a
-- member, which failed for the whole group (F-01 of the 2026-11-19 review). The trigger drops these rows when a
-- membership ends (admin removal, merge, user or group deletion); build orders stay, so a member who is added back
-- finds their plan, and the scheduler only looks at members. A rebuild of group_members must recreate it.
DELETE FROM building_alerts WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = building_alerts.group_id AND m.user_id = building_alerts.user_id);
DELETE FROM fleet_alerts WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = fleet_alerts.group_id AND m.user_id = fleet_alerts.user_id);
DELETE FROM storage_full WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = storage_full.group_id AND m.user_id = storage_full.user_id);

CREATE TRIGGER group_members_alerts_delete AFTER DELETE ON group_members
BEGIN
  DELETE FROM building_alerts WHERE group_id = OLD.group_id AND user_id = OLD.user_id;
  DELETE FROM fleet_alerts WHERE group_id = OLD.group_id AND user_id = OLD.user_id;
  DELETE FROM storage_full WHERE group_id = OLD.group_id AND user_id = OLD.user_id;
END;
