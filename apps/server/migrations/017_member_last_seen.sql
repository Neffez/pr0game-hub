-- Last time a member had the hub open (end of their last live connection), for "last online" in the members list.
ALTER TABLE group_members ADD COLUMN last_seen_at INTEGER;
